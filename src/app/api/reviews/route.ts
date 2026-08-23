import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";
import { kstDateString, addDays } from "@/lib/time";

// GET /api/reviews — 주간 회고 목록 (무료 30일 경계 적용)
export async function GET() {
  try {
    const { profile } = await requireUser();
    const freeFrom = profile.plan === "free" ? addDays(kstDateString(), -30) : null;
    let query = db().from("weekly_reviews")
      .select("id, week_start, body, highlights, stats, opened_at, created_at")
      .eq("user_id", profile.user_id)
      .order("week_start", { ascending: false })
      .limit(20);
    if (freeFrom) query = query.gte("week_start", freeFrom);
    const { data } = await query;
    return Response.json({ reviews: data ?? [] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/reviews {weekStart?} — 열람 기록 (K6)
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const { weekStart } = await req.json();
    await db().from("weekly_reviews").update({ opened_at: new Date().toISOString() })
      .eq("user_id", profile.user_id).eq("week_start", weekStart).is("opened_at", null);
    await db().from("analytics_events").insert({ user_id: profile.user_id, name: "weekly_review_opened" });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
