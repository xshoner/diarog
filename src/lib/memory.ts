import { db } from "./supabase";
import { chatJSON, embed, type ChatMessage } from "./letsur";

type MemoryKind = "preference" | "routine" | "relationship" | "goal" | "fact" | "pattern";

interface MemoryExtraction {
  memories: Array<{
    kind: MemoryKind;
    content: string;
    confidence?: number;
    evidence?: string;
  }>;
}

export async function refreshPersonalMemories(userId: string, date: string): Promise<void> {
  const [{ data: diary }, { data: moments }, { data: signals }] = await Promise.all([
    db().from("diary_entries").select("body_final, one_line").eq("user_id", userId).eq("date", date).maybeSingle(),
    db().from("moments").select("title, place_name, people, mood, memo, ai").eq("user_id", userId).eq("date", date)
      .in("status", ["confirmed", "soft_confirmed"]).order("starts_at"),
    db().from("life_signals").select("source, title, summary, payload, occurred_at")
      .eq("user_id", userId)
      .gte("occurred_at", `${date}T00:00:00+09:00`)
      .lt("occurred_at", new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 86400_000).toISOString())
      .limit(50),
  ]);

  if (!diary?.body_final && !(moments?.length) && !(signals?.length)) return;

  const system = [
    "너는 사용자의 장기 기억을 갱신하는 개인 컨텍스트 추출기다.",
    "하루 기록에서 앞으로도 도움이 될 가능성이 높은 안정적 정보를 추출한다.",
    "일회성 사건을 과도하게 일반화하지 말고, 불확실하면 confidence를 낮춘다.",
    "민감한 건강·정치·종교·성적 정보는 저장하지 않는다.",
    "관계는 '누구와 어떤 맥락에서 자주 상호작용하는지' 수준으로만 기록한다.",
    "기억 종류: preference, routine, relationship, goal, fact, pattern.",
    "최대 6개. 같은 의미의 기억은 하나로 합친다.",
    "반드시 JSON만 응답한다:",
    JSON.stringify({ memories: [{ kind: "preference", content: "사용자는 ...를 선호한다", confidence: 0.8, evidence: "근거 요약" }] }),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify({ date, diary, moments: moments ?? [], signals: signals ?? [] }) },
  ];

  const result = await chatJSON<MemoryExtraction>(messages, { userId, kind: "call4", maxTokens: 2500, temperature: 0.2 });
  for (const m of (result.memories ?? []).slice(0, 6)) {
    const content = m.content?.trim();
    if (!content) continue;
    let vector: number[] | null = null;
    try { vector = await embed(content, userId); } catch {}
    await db().from("personal_memories").upsert({
      user_id: userId,
      kind: m.kind,
      content,
      confidence: Math.max(0.3, Math.min(1, Number(m.confidence ?? 0.7))),
      source_date: date,
      evidence: { note: m.evidence ?? null },
      ...(vector ? { embedding: JSON.stringify(vector) } : {}),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,kind,content" });
  }
}

export async function recentPersonalMemories(userId: string, limit = 12): Promise<Array<{kind: string; content: string; confidence: number}>> {
  const { data } = await db().from("personal_memories")
    .select("kind, content, confidence")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{kind: string; content: string; confidence: number}>;
}
