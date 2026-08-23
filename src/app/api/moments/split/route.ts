import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// POST /api/moments/split {momentId, photoIds[]} — 선택 사진을 새 Moment로 분리 (FR-4.5)
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const { momentId, photoIds } = await req.json();
    if (!momentId || !Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const { data: moment } = await db().from("moments")
      .select("*").eq("id", momentId).eq("user_id", userId).single();
    if (!moment) return Response.json({ error: "not found" }, { status: 404 });

    const { data: movingPhotos } = await db().from("photos")
      .select("id, taken_at").eq("user_id", userId).eq("moment_id", momentId).in("id", photoIds)
      .order("taken_at");
    if (!movingPhotos?.length) return Response.json({ error: "photos not in moment" }, { status: 400 });

    const { data: newMoment } = await db().from("moments").insert({
      user_id: userId,
      date: moment.date,
      seq: moment.seq + 1,
      title: `${moment.title ?? "기록"} (분리)`,
      starts_at: movingPhotos[0].taken_at,
      ends_at: movingPhotos[movingPhotos.length - 1].taken_at,
      address: moment.address,
      lat: moment.lat,
      lng: moment.lng,
      status: "draft",
    }).select("id").single();
    if (!newMoment) return Response.json({ error: "split failed" }, { status: 500 });

    await db().from("photos").update({ moment_id: newMoment.id })
      .eq("user_id", userId).in("id", photoIds);
    await db().from("corrections").insert({
      user_id: userId, moment_id: momentId, kind: "split",
      before: { photo_count: photoIds.length }, after: { new_moment_id: newMoment.id },
    });
    return Response.json({ newMomentId: newMoment.id });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
