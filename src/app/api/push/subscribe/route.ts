import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const sub = await req.json();
    if (!sub?.endpoint) return Response.json({ error: "bad subscription" }, { status: 400 });
    await db().from("users_profile").update({ push_subscription: sub }).eq("user_id", profile.user_id);
    await db().from("analytics_events").insert({ user_id: profile.user_id, name: "push_granted" });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { profile } = await requireUser();
    await db().from("users_profile").update({ push_subscription: null }).eq("user_id", profile.user_id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
