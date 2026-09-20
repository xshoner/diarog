export interface ContextSignal {
  id: string; source: string; occurred_at: string; ended_at?: string | null;
  title?: string | null; summary?: string | null; payload?: Record<string, unknown> | null;
  external_id?: string | null; created_at?: string;
}
export interface ContextMemory { id: string; kind: string; content: string; confidence: number }

const ms = (value: string | null | undefined) => value ? Date.parse(value) : NaN;
const limited = (value: unknown, length: number) => typeof value === "string" ? value.slice(0, length) : "";

/** Keep temporal relevance explicit. A daily step aggregate is not an event at midnight. */
export function selectMomentSignals(signals: ContextSignal[], start: string, end: string) {
  const from = ms(start), to = ms(end);
  const kstDate = (time: number) => Number.isFinite(time) ? new Date(time + 9 * 3600_000).toISOString().slice(0, 10) : "";
  const gap = (s: ContextSignal) => Math.max(0, ms(s.occurred_at) - to, from - (Number.isFinite(ms(s.ended_at)) ? ms(s.ended_at) : ms(s.occurred_at)));
  const audio = signals.filter(s => s.source === "audio" && gap(s) <= 90 * 60_000)
    .sort((a, b) => gap(a) - gap(b)).slice(0, 4);
  const locations = signals.filter(s => s.source === "location" && gap(s) <= 30 * 60_000 &&
    typeof s.payload?.accuracyMeters === "number" && s.payload.accuracyMeters <= 2000 && s.payload.accuracyMeters >= 0)
    .sort((a, b) => gap(a) - gap(b)).slice(0, 6);
  // Use a single latest aggregate across devices; never sum overlapping step totals.
  const steps = signals.filter(s => s.source === "steps" &&
    (typeof s.payload?.date === "string" ? s.payload.date : kstDate(ms(s.occurred_at))) === kstDate(from)).sort((a, b) => {
    const updated = (s: ContextSignal) => ms(typeof s.payload?.aggregatedAt === "string" ? s.payload.aggregatedAt : s.ended_at ?? s.occurred_at);
    return updated(b) - updated(a);
  }).slice(0, 1);
  return [...audio, ...locations, ...steps].map(s => ({
    id: s.id, source: s.source, occurredAt: s.occurred_at, endedAt: s.ended_at ?? null,
    title: limited(s.title, 100), summary: limited(s.summary, s.source === "audio" ? 1200 : 200),
    scope: s.source === "steps" ? "daily_total_not_photo_event" : "nearby_time_not_proof_of_same_event",
    uncertainTime: s.source === "audio" && s.payload?.timingSource !== "filename",
    details: s.source === "steps" ? { count: s.payload?.count, date: s.payload?.date }
      : s.source === "location" ? { lat: s.payload?.lat, lng: s.payload?.lng, accuracyMeters: s.payload?.accuracyMeters }
      : { needsReview: true },
  }));
}

export function citedIds(value: unknown, allowed: string[]) {
  const valid = new Set(allowed);
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && valid.has(id)))] : [];
}

export function sourceCounts(signals: Array<{ source: string }>) {
  return signals.reduce<Record<string, number>>((counts, signal) => {
    counts[signal.source] = (counts[signal.source] ?? 0) + 1; return counts;
  }, {});
}

export async function mapConcurrent<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(values.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while(next < values.length) { const index = next++; output[index] = await task(values[index]); }
  }));
  return output;
}
