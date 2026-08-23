import { db } from "./supabase";
import { chatJSON, ChatMessage } from "./letsur";
import { personaSystemPrompt } from "./personas";
import { addDays } from "./time";

// Call-3: 주간 회고 (§8.4, FR-7)

interface Call3Result {
  review: string;
  highlights: Array<{ momentId: string; reason: string }>;
}

export async function generateWeeklyReview(userId: string, weekStart: string): Promise<boolean> {
  const weekEnd = addDays(weekStart, 6);

  const { data: momentRows } = await db().from("moments")
    .select("id, date, title, place_name, people, mood, linked_event_id")
    .eq("user_id", userId)
    .gte("date", weekStart).lte("date", weekEnd)
    .in("status", ["confirmed", "soft_confirmed"])
    .order("date");
  const moments = momentRows ?? [];
  if (moments.length < 3) return false; // FR-7.1: 확정 Moment ≥ 3

  const { data: profile } = await db().from("users_profile")
    .select("persona_type, calendar_connected").eq("user_id", userId).single();

  // Plan vs Lived (FR-7.2)
  let planVsLived: Record<string, number> | null = null;
  if (profile?.calendar_connected) {
    const { count: planned } = await db().from("calendar_events_cache")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("starts_at", `${weekStart}T00:00:00+09:00`)
      .lt("starts_at", `${addDays(weekStart, 7)}T00:00:00+09:00`);
    const linked = moments.filter((m) => m.linked_event_id).length;
    planVsLived = {
      예정: planned ?? 0,
      진행: linked,
      계획에없던사건: moments.length - linked,
    };
  }

  const places = [...new Set(moments.map((m) => m.place_name).filter(Boolean))];
  const people = [...new Set(moments.flatMap((m) => ((m.people ?? []) as Array<{ name: string }>).map((p) => p.name)))];
  const stats = {
    momentCount: moments.length,
    placeCount: places.length,
    places: places.slice(0, 10),
    people: people.slice(0, 10),
    planVsLived,
  };

  const system = [
    personaSystemPrompt(profile?.persona_type ?? "plain"),
    "",
    "작업: 이번 주 확정 기록을 바탕으로 주간 회고를 5~8문장으로 쓴다.",
    "하이라이트 Moment 3개를 선정하고 이유를 붙인다.",
    "반드시 JSON으로만 응답:",
    JSON.stringify({ review: "회고 문단", highlights: [{ momentId: "id", reason: "선정 이유" }] }),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: `주간(${weekStart}~) Moment 목록:\n${JSON.stringify(moments, null, 1)}\n\n통계: ${JSON.stringify(stats)}` },
  ];

  try {
    const result = await chatJSON<Call3Result>(messages, { userId, kind: "call3", maxTokens: 5000, temperature: 0.7 });
    await db().from("weekly_reviews").upsert({
      user_id: userId,
      week_start: weekStart,
      body: result.review,
      highlights: (result.highlights ?? []).slice(0, 3),
      stats,
    }, { onConflict: "user_id,week_start" });
    return true;
  } catch {
    return false;
  }
}
