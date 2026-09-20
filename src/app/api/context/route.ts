import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

export async function GET(req: Request) {
  try {
    const { profile } = await requireUser();
    const id = new URL(req.url).searchParams.get("momentId");
    if(!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "invalid moment ID" }, { status: 400 });
    const { data: moment, error } = await db().from("moments").select("ai").eq("user_id", profile.user_id).eq("id", id).maybeSingle();
    if(error) throw error;
    if(!moment) return Response.json({ error: "not found" }, { status: 404 });
    const audit = moment.ai?.context;
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)).slice(0, 20) : [];
    const signalIds = ids(audit?.suppliedSignalIds), memoryIds = ids(audit?.suppliedMemoryIds);
    const [signals, memories] = await Promise.all([
      signalIds.length ? db().from("life_signals").select("id,source,title,summary,occurred_at").eq("user_id", profile.user_id).in("id", signalIds) : Promise.resolve({ data: [], error: null }),
      memoryIds.length ? db().from("personal_memories").select("id,kind,content,source_date").eq("user_id", profile.user_id).in("id", memoryIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if(signals.error || memories.error) throw new Error("context read failed");
    // Resolve current records, so deleted memories/signals do not linger as copied text.
    return Response.json({ signals: signals.data, memories: memories.data }, { headers: { "Cache-Control": "no-store" } });
  } catch(e) {
    if(e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: "참고 자료를 불러오지 못했습니다." }, { status: 503 });
  }
}
