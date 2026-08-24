import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { assembleDay } from "@/lib/assemble";
import { syncCalendar } from "@/lib/google";
import { db } from "@/lib/supabase";
import { kstDateString } from "@/lib/time";

export const maxDuration = 300;

// POST /api/moments/assemble {date?} — 당일 재조립 트리거
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const body = await req.json().catch(() => ({}));
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date : kstDateString();
    // 조립 전 캘린더 최신화 — 단, 10분 내 동기화 이력이 있으면 생략 (업로드 연타 시 지연 방지)
    if (profile.calendar_connected) {
      const { data: last } = await db().from("calendar_events_cache")
        .select("synced_at").eq("user_id", profile.user_id)
        .order("synced_at", { ascending: false }).limit(1).maybeSingle();
      const fresh = last && Date.now() - new Date(last.synced_at).getTime() < 10 * 60_000;
      if (!fresh) await syncCalendar(profile.user_id).catch(() => {});
    }
    const result = await assembleDay(profile.user_id, date);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
