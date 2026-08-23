import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// POST /api/moments/merge {keepId, mergeId} — 두 Moment 병합 (FR-4.5)
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const { keepId, mergeId } = await req.json();
    if (!keepId || !mergeId || keepId === mergeId) return Response.json({ error: "bad request" }, { status: 400 });

    const { data: rows } = await db().from("moments")
      .select("id, starts_at, ends_at").eq("user_id", userId).in("id", [keepId, mergeId]);
    if ((rows ?? []).length !== 2) return Response.json({ error: "not found" }, { status: 404 });
    const keep = rows!.find((r) => r.id === keepId)!;
    const merge = rows!.find((r) => r.id === mergeId)!;

    await db().from("photos").update({ moment_id: keepId })
      .eq("user_id", userId).eq("moment_id", mergeId);
    await db().from("moments").update({
      starts_at: [keep.starts_at, merge.starts_at].sort()[0],
      ends_at: [keep.ends_at, merge.ends_at].sort().reverse()[0],
    }).eq("id", keepId);
    await db().from("moments").delete().eq("id", mergeId).eq("user_id", userId);
    await db().from("corrections").insert({
      user_id: userId, moment_id: keepId, kind: "merge",
      before: { merged_id: mergeId }, after: { keep_id: keepId },
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
