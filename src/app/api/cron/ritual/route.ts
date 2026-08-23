import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { sendPush } from "@/lib/push";
import { assembleDay } from "@/lib/assemble";
import { syncCalendar } from "@/lib/google";
import { kstDateString, addDays } from "@/lib/time";
import { env } from "@/lib/env";

export const maxDuration = 300;

// CRON 21:00 KST — 초안 마감 조립 + 푸시 발송 (§9)
// + 3일 경과 미확정 draft 자동 임시확정(soft-confirm, §5.3-6)
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (env.cronSecret() && auth !== `Bearer ${env.cronSecret()}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstDateString();
  const results = { pushed: 0, assembled: 0, softConfirmed: 0, lightNudge: 0 };

  // 3일 경과 draft → soft_confirmed
  const cutoff = addDays(today, -3);
  const { data: stale } = await db().from("moments")
    .update({ status: "soft_confirmed", confirmed_at: new Date().toISOString() })
    .eq("status", "draft").lte("date", cutoff).select("id");
  results.softConfirmed = stale?.length ?? 0;

  const { data: users } = await db().from("users_profile")
    .select("user_id, push_subscription, calendar_connected")
    .not("push_subscription", "is", null);

  for (const u of users ?? []) {
    try {
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
