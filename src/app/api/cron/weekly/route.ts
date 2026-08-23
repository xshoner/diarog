import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { sendPush } from "@/lib/push";
import { generateWeeklyReview } from "@/lib/weekly";
import { kstDateString, weekStartOf, addDays } from "@/lib/time";
import { env } from "@/lib/env";

export const maxDuration = 300;

// CRON 일요일 20:00 KST — 주간 회고 생성 + 푸시 (FR-7.1)
export async function GET(req: NextRequest) {
  // Vercel Cron(UA) 또는 CRON_SECRET 일치 시 허용
  const auth = req.headers.get("authorization");
  const isVercelCron = (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!isVercelCron && auth !== `Bearer ${env.cronSecret()}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstDateString();
  const weekStart = weekStartOf(today); // 이번 주 월요일 (일요일 저녁 실행 기준 지난 6일 포함)
  const results = { generated: 0, pushed: 0 };

  const { data: users } = await db().from("users_profile").select("user_id");
  for (const u of users ?? []) {
    try {
      // 이미 생성됐으면 스킵 (익일 재시도 대비 멱등)
      const { data: existing } = await db().from("weekly_reviews")
        .select("id").eq("user_id", u.user_id).eq("week_start", weekStart).maybeSingle();
      if (existing) continue;
      const ok = await generateWeeklyReview(u.user_id, weekStart);
      if (ok) {
        results.generated++;
        const sent = await sendPush(u.user_id, {
          title: "이번 주 회고가 도착했어요",
          body: `${weekStart} ~ ${addDays(weekStart, 6)} 한 주의 이야기를 확인해 보세요.`,
          url: "/weekly",
        });
        if (sent) results.pushed++;
      }
    } catch { /* 사용자 단위 실패 무시 */ }
  }

  return Response.json(results);
}
