import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// PATCH /api/diary/:date {sentIdx, revised} — 문장 수정 → persona_edits 기록 (2층 학습)
export async function PATCH(req: Request, ctx: { params: Promise<{ date: string }> }) {
  try {
    const { profile } = await requireUser();
    const { date } = await ctx.params;
    const userId = profile.user_id;
    const { sentIdx, revised } = await req.json();
    if (typeof sentIdx !== "number" || typeof revised !== "string" || !revised.trim()) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }

    const { data: entry } = await db().from("diary_entries")
      .select("*").eq("user_id", userId).eq("date", date).single();
    if (!entry) return Response.json({ error: "not found" }, { status: 404 });

    const sentences = entry.sentences as Array<{ text: string; evidence_refs: string[]; kind: string }>;
    if (!sentences[sentIdx]) return Response.json({ error: "bad index" }, { status: 400 });

    const original = sentences[sentIdx].text;
    sentences[sentIdx] = { ...sentences[sentIdx], text: revised.trim().slice(0, 500) };
    const bodyFinal = sentences.map((s) => s.text).join(" ");

    await db().from("diary_entries").update({
      sentences, body_final: bodyFinal, edited: true,
    }).eq("user_id", userId).eq("date", date);

    // (원문, 수정문) 쌍 저장 — 페르소나 2층 학습 데이터
    await db().from("persona_edits").insert({
      user_id: userId, source: "diary", original, revised: revised.trim().slice(0, 500),
    });
    await db().from("analytics_events").insert({ user_id: userId, name: "diary_sentence_edited" });

    return Response.json({ ok: true, sentences, body: bodyFinal });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
