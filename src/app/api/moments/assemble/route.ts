import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { assembleDay } from "@/lib/assemble";
import { kstDateString } from "@/lib/time";

export const maxDuration = 300;

// POST /api/moments/assemble {date?} — 당일 재조립 트리거
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const body = await req.json().catch(() => ({}));
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date : kstDateString();
    const result = await assembleDay(profile.user_id, date);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
