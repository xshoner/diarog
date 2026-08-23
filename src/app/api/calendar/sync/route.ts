import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { syncCalendar } from "@/lib/google";

export const maxDuration = 60;

export async function POST() {
  try {
    const { profile } = await requireUser();
    const result = await syncCalendar(profile.user_id);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
