import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, signPaths } from "@/lib/supabase";

// GET /api/days/:date — 해당일 Moment·사진·일기·질문 번들 (리추얼/홈 화면)
export async function GET(_req: Request, ctx: { params: Promise<{ date: string }> }) {
  try {
    const { profile } = await requireUser();
    const { date } = await ctx.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "bad date" }, { status: 400 });
    const userId = profile.user_id;

    const [{ data: moments }, { data: diary }] = await Promise.all([
      db().from("moments").select("*").eq("user_id", userId).eq("date", date).order("starts_at"),
      db().from("diary_entries").select("*").eq("user_id", userId).eq("date", date).maybeSingle(),
    ]);

    const momentIds = (moments ?? []).map((m) => m.id);
    let photos: Array<Record<string, unknown>> = [];
    let questions: Array<Record<string, unknown>> = [];
    let evidence: Array<Record<string, unknown>> = [];
    if (momentIds.length) {
      const [p, q, e] = await Promise.all([
        db().from("photos").select("id, taken_at, lat, lng, gps_source, storage_thumb_path, storage_mid_path, is_receipt, moment_id")
          .eq("user_id", userId).in("moment_id", momentIds).order("taken_at"),
        db().from("moment_questions").select("*").in("moment_id", momentIds).is("answered_at", null),
        db().from("moment_evidence").select("id, moment_id, type, payload, score").in("moment_id", momentIds),
      ]);
      photos = p.data ?? [];
      questions = q.data ?? [];
      evidence = e.data ?? [];
    }

    // 썸네일 서명 URL
    const paths = photos.flatMap((p) => [p.storage_thumb_path as string, p.storage_mid_path as string]);
    const signed = await signPaths(paths);
    const photosOut = photos.map((p) => ({
      ...p,
      thumbUrl: signed[p.storage_thumb_path as string] ?? null,
      midUrl: signed[p.storage_mid_path as string] ?? null,
      storage_thumb_path: undefined,
      storage_mid_path: undefined,
    }));

    return Response.json({ date, moments: moments ?? [], photos: photosOut, diary, questions, evidence });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
