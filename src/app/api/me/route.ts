import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

export async function GET() {
  try {
    const { profile } = await requireUser();
    return Response.json({
      userId: profile.user_id,
      email: profile.email,
      name: profile.display_name,
      avatar: profile.avatar_url,
      persona: profile.persona_type,
      ritualTime: profile.ritual_time,
      calendarConnected: profile.calendar_connected,
      pushEnabled: !!profile.push_subscription,
      onboarded: profile.onboarded,
      plan: profile.plan,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }
}

export async function PATCH(req: Request) {
  try {
    const { profile } = await requireUser();
    const body = await req.json();
    const update: Record<string, unknown> = {};
    if (["plain", "essay", "humor", "dry"].includes(body.persona)) update.persona_type = body.persona;
    if (typeof body.ritualTime === "string" && /^\d{2}:\d{2}$/.test(body.ritualTime)) update.ritual_time = body.ritualTime;
    if (typeof body.onboarded === "boolean") update.onboarded = body.onboarded;
    if (Object.keys(update).length === 0) return Response.json({ error: "no valid fields" }, { status: 400 });
    await db().from("users_profile").update(update).eq("user_id", profile.user_id);
    if (body.onboarded === true) {
      await db().from("analytics_events").insert({ user_id: profile.user_id, name: "onboarding_completed" });
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }
}
