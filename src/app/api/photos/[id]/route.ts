import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, PHOTO_BUCKET } from "@/lib/supabase";

// DELETE /api/photos/:id — 사진 완전 삭제 (스토리지 포함).
// 소속 Moment에 사진이 하나도 남지 않으면 Moment도 함께 삭제한다.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUser();
    const { id } = await ctx.params;
    const userId = profile.user_id;

    const { data: photo } = await db().from("photos")
      .select("id, moment_id, storage_mid_path, storage_thumb_path")
      .eq("id", id).eq("user_id", userId).single();
    if (!photo) return Response.json({ error: "not found" }, { status: 404 });

    await db().storage.from(PHOTO_BUCKET)
      .remove([photo.storage_mid_path, photo.storage_thumb_path]).catch(() => {});
    const { error } = await db().from("photos").delete().eq("id", id).eq("user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let momentDeleted = false;
    if (photo.moment_id) {
      const { count } = await db().from("photos")
        .select("id", { count: "exact", head: true }).eq("moment_id", photo.moment_id);
      if (!count) {
        await db().from("moments").delete().eq("id", photo.moment_id).eq("user_id", userId);
        momentDeleted = true;
      }
    }
    await db().from("analytics_events").insert({ user_id: userId, name: "photo_deleted" });
    return Response.json({ ok: true, momentDeleted });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
