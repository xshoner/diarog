import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";
import { refreshPersonalMemories } from "@/lib/memory";
import { sameOrigin } from "@/lib/companion";
import { InputError, readJsonLimited } from "@/lib/signal-validation";

export const maxDuration = 300;
function failure(e: unknown) {
  if (e instanceof UnauthorizedError) return unauthorizedResponse();
  if (e instanceof InputError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: "개인화 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
}
export async function GET() {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const [memories, diaries, corrections, activity] = await Promise.all([
      db().from("personal_memories").select("id,kind,content,confidence,source_date,last_seen_at,evidence")
        .eq("user_id", userId).order("last_seen_at", { ascending: false }).limit(100),
      db().from("diary_entries").select("date,edited").eq("user_id", userId).order("date", { ascending: false }).limit(100),
      db().from("persona_edits").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "diary"),
      db().from("analytics_events").select("id,name,props,created_at").eq("user_id", userId)
        .in("name", ["context_assembled", "memory_refresh", "diary_context"]).order("created_at", { ascending: false }).limit(40),
    ]);
    if (memories.error || diaries.error || corrections.error) throw new Error("unavailable");
    const seen = new Set<string>();
    const activities = (activity.data ?? []).filter(a => {
      const key = a.props?.runId ?? a.id;
      if(seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 20);
    return Response.json({ memories: memories.data, diaries: diaries.data, corrections: corrections.count ?? 0,
      activities, activityAvailable: !activity.error }, { headers: { "Cache-Control": "no-store" } });
  } catch(e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { profile } = await requireUser();
    const body = await readJsonLimited(req) as { date?: string };
    if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new InputError("날짜를 선택해 주세요.");
    const { data, error } = await db().from("diary_entries").select("date").eq("user_id", profile.user_id).eq("date", body.date).maybeSingle();
    if (error) throw error;
    if (!data) throw new InputError("저장된 일기가 없습니다.", 404);
    await refreshPersonalMemories(profile.user_id, body.date);
    return Response.json({ ok: true });
  } catch(e) { return failure(e); }
}
export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const { profile } = await requireUser();
    const body = await readJsonLimited(req) as { id?: string };
    if (!body || typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new InputError("잘못된 기억 ID");
    const { error } = await db().from("personal_memories").delete().eq("user_id", profile.user_id).eq("id", body.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch(e) { return failure(e); }
}
