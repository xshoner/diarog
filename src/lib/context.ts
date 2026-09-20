import { db } from "./supabase";
import { kstDayRange } from "./time";
import type { ContextSignal, ContextMemory } from "./context-selection";

/** One pair of bounded queries per photo batch, shared across all clusters. */
export async function loadDayContext(userId: string, date: string) {
  const { start, end } = kstDayRange(date);
  const [signals, memories] = await Promise.all([
    db().from("life_signals").select("id,source,occurred_at,ended_at,title,summary,payload", { count: "exact" })
      .eq("user_id", userId).gte("occurred_at", new Date(start.getTime() - 90 * 60_000).toISOString())
      .lt("occurred_at", new Date(end.getTime() + 90 * 60_000).toISOString())
      .in("source", ["audio", "location", "steps"]).order("occurred_at", { ascending: false }).limit(1000),
    db().from("personal_memories").select("id,kind,content,confidence").eq("user_id", userId)
      .gte("confidence", 0.7).lte("source_date", date).order("last_seen_at", { ascending: false }).limit(12),
  ]);
  return {
    signals: (signals.error ? [] : signals.data ?? []) as ContextSignal[],
    memories: (memories.error ? [] : memories.data ?? []) as ContextMemory[],
    signalsAvailable: !signals.error, memoriesAvailable: !memories.error,
    truncated: (signals.count ?? 0) > 1000,
  };
}
