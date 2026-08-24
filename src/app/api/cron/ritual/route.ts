import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { sendPush } from "@/lib/push";
import { assembleDay } from "@/lib/assemble";
import { syncCalendar } from "@/lib/google";
import { kstDateString, addDays } from "@/lib/time";
import { env } from "@/lib/env";

export const maxDuration = 300;

// 리추얼 크론 — 사용자별 ritual_time(KST) 시각에 맞춰 조립 + 푸시 (§9)
// 호출 경로: ① Supabase pg_cron(매시) ② Vercel Cron(21:00 KST, 폴백/캐치업)
// + 3일 경과 미확정 draft 자동 임시확정(soft-confirm, §5.3-6)
export async function GET(req: NextRequest) {
  // Vercel Cron(UA) 또는 CRON_SECRET 일치 시 허용
  const auth = req.headers.get("authorization");
  const isVercelCron = (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!isVercelCron && auth !== `Bearer ${env.cronSecret()}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstDateString();
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  const kstHour = kstNow.getUTCHours();
  const nowMin = kstHour * 60 + kstNow.getUTCMinutes();
  const results = { pushed: 0, assembled: 0, softConfirmed: 0, lightNudge: 0, skipped: 0 };

  // 3일 경과 draft → soft_confirmed (멱등 — 매 실행 무해)
  const cutoff = addDays(today, -3);
  const { data: stale } = await db().from("moments")
    .update({ status: "soft_confirmed", confirmed_at: new Date().toISOString() })
    .eq("status", "draft").lte("date", cutoff).select("id");
  results.softConfirmed = stale?.length ?? 0;

  const { data: users } = await db().from("users_profile")
    .select("user_id, push_subscription, calendar_connected, ritual_time")
    .not("push_subscription", "is", null);

  for (const u of users ?? []) {
    try {
      // 사용자 설정 시각(ritual_time)을 지난 뒤 첫 실행(60분 이내)에 발송.
      // 예: 14:55 설정 + 매시 5분 크론 → 15:05 실행에서 발송 (14:05 조기 발송 방지).
      // 21시는 캐치업 시간 (pg_cron 미가동 등으로 오늘 아무 알림도 못 받은 사용자 보장).
      const rt = String(u.ritual_time ?? "21:00");
      const ritualMin = Number(rt.slice(0, 2)) * 60 + (Number(rt.slice(3, 5)) || 0);
      const sinceRitual = nowMin - ritualMin;
      const isUsersWindow = Number.isFinite(ritualMin) && sinceRitual >= 0 && sinceRitual < 60;
      const isCatchUp = kstHour === 21;
      if (!isUsersWindow && !isCatchUp) { results.skipped++; continue; }

      // 오늘 이미 알림을 보냈으면 중복 발송 방지 (시간별 + 일일 크론 공존 대비)
      const { count: sentToday } = await db().from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.user_id)
        .in("name", ["ritual_push_sent", "light_nudge_sent"])
        .gte("created_at", `${today}T00:00:00+09:00`);
      if ((sentToday ?? 0) > 0) { results.skipped++; continue; }
      // 당일 사진 유무
      const { count: photoCount } = await db().from("photos")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.user_id)
        .gte("taken_at", `${today}T00:00:00+09:00`);

      if (photoCount && photoCount > 0) {
        // 마감 조립 (캘린더 최신화 후)
        if (u.calendar_connected) await syncCalendar(u.user_id).catch(() => {});
        await assembleDay(u.user_id, today).catch(() => {});
        results.assembled++;

        const { count: draftCount } = await db().from("moments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.user_id).eq("date", today).eq("status", "draft");
        if (draftCount && draftCount > 0) {
          const ok = await sendPush(u.user_id, {
            title: "오늘의 기록이 준비됐어요",
            body: `${draftCount}개의 순간이 확인을 기다립니다. 30초면 충분해요.`,
            url: `/ritual/${today}`,
          });
          if (ok) {
            results.pushed++;
            await db().from("analytics_events").insert({ user_id: u.user_id, name: "ritual_push_sent" });
          }
        }
      } else {
        // 라이트 알림 (주 최대 3회 빈도 제한)
        const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { count: recent } = await db().from("analytics_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.user_id).eq("name", "light_nudge_sent").gte("created_at", weekAgo);
        if ((recent ?? 0) < 3) {
          const ok = await sendPush(u.user_id, {
            title: "오늘 남길 사진이 있나요?",
            body: "사진 한 장이면 오늘이 기록됩니다.",
            url: "/upload",
          });
          if (ok) {
            results.lightNudge++;
            await db().from("analytics_events").insert({ user_id: u.user_id, name: "light_nudge_sent" });
          }
        }
      }
    } catch { /* 사용자 단위 실패 무시 */ }
  }

  return Response.json(results);
}
