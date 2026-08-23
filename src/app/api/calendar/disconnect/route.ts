import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// 연동 해제 시 캐시 즉시 삭제 (FR-1.3 AC)
export async function POST() {
  try {
    const { profile } = await requireUser();
    await db().from("users_profile").update({
      calendar_connected: false, google_refresh_token: null,
    }).eq("user_id", profile.user_id);
    await db().from("calendar_events_cache").delete().eq("user_id", profile.user_id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
