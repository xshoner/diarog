import { requireUser, UnauthorizedError, unauthorizedResponse, destroySession } from "@/lib/session";
import { db, PHOTO_BUCKET } from "@/lib/supabase";

export const maxDuration = 300;

// POST /api/account/delete — 계정 삭제 (FR-10.3): 전 테이블 cascade + Storage 파기
export async function POST() {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;

    // Storage 정리 (사용자 폴더)
    const storage = db().storage.from(PHOTO_BUCKET);
    const { data: photos } = await db().from("photos")
      .select("storage_thumb_path, storage_mid_path").eq("user_id", userId);
    const paths = (photos ?? []).flatMap((p) => [p.storage_thumb_path, p.storage_mid_path]);
    for (let i = 0; i < paths.length; i += 100) {
      await storage.remove(paths.slice(i, i + 100)).catch(() => {});
    }

    // users_profile 삭제 → 전 테이블 FK cascade
    await db().from("users_profile").delete().eq("user_id", userId);
    await destroySession();
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
