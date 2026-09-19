import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, signPaths } from "@/lib/supabase";
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
    const reviews = data ?? [];
    const highlightIds = reviews
      .map((r) => Array.isArray(r.highlights) ? r.highlights[0]?.momentId : null)
      .filter((x): x is string => typeof x === "string");
    const covers: Record<string, string> = {};
    if (highlightIds.length) {
      const { data: photos } = await db().from("photos")
        .select("moment_id, storage_thumb_path, taken_at")
        .eq("user_id", profile.user_id)
        .in("moment_id", highlightIds)
        .order("taken_at");
      const firstByMoment = new Map<string, string>();
      for (const p of photos ?? []) {
        if (p.moment_id && !firstByMoment.has(p.moment_id)) firstByMoment.set(p.moment_id, p.storage_thumb_path);
      }
      const signed = await signPaths([...firstByMoment.values()]);
      for (const [momentId, path] of firstByMoment) covers[momentId] = signed[path] ?? "";
    }
    return Response.json({
      reviews: reviews.map((r) => {
        const first = Array.isArray(r.highlights) ? r.highlights[0]?.momentId : null;
        return { ...r, coverThumbUrl: first ? covers[first] || null : null };
      }),
    });
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
