import { test } from "node:test";
import assert from "node:assert/strict";
import { selectMomentSignals, citedIds, mapConcurrent, type ContextSignal } from "../src/lib/context-selection";

const moment = "2026-09-20T12:00:00+09:00";
const signal = (id: string, source: string, occurred_at: string, payload: Record<string, unknown> = {}): ContextSignal => ({ id, source, occurred_at, payload, summary: "fixture" });

test("photo context selects nearby calls/accurate locations and one latest daily step total", () => {
  const input = [
    signal("call", "audio", "2026-09-20T11:00:00+09:00", { timingSource: "filename" }),
    signal("old-call", "audio", "2026-09-20T08:00:00+09:00"),
    signal("near", "location", "2026-09-20T11:50:00+09:00", { accuracyMeters: 20 }),
    signal("vague", "location", "2026-09-20T11:55:00+09:00", { accuracyMeters: 3000 }),
    signal("unknown", "location", "2026-09-20T11:55:00+09:00"),
    signal("far", "location", "2026-09-20T10:00:00+09:00", { accuracyMeters: 10 }),
    signal("steps1", "steps", "2026-09-20T00:00:00+09:00", { count: 200, aggregatedAt: "2026-09-20T10:00:00+09:00" }),
    signal("steps2", "steps", "2026-09-20T00:00:00+09:00", { count: 400, aggregatedAt: "2026-09-20T11:00:00+09:00" }),
    signal("yesterday", "steps", "2026-09-19T00:00:00+09:00", { count: 10000, aggregatedAt: "2026-09-20T11:55:00+09:00" }),
  ];
  const selected = selectMomentSignals(input, moment, moment);
  assert.deepEqual(selected.map(s => s.id), ["call", "near", "steps2"]);
  assert.equal(selected[2].details.count, 400);
  assert.equal(selected[2].scope, "daily_total_not_photo_event");
  assert.equal(selected[0].uncertainTime, false);
});

test("cross-midnight call context works and fabricated citations are discarded", () => {
  const nearMidnight = selectMomentSignals([
    signal("night", "audio", "2026-09-19T23:50:00+09:00", { timingSource: "file_modified" }),
  ], "2026-09-20T00:10:00+09:00", "2026-09-20T00:10:00+09:00");
  assert.equal(nearMidnight[0].id, "night");
  assert.equal(nearMidnight[0].uncertainTime, true);
  assert.deepEqual(citedIds(["night", "foreign-id", "night", 1], ["night"]), ["night"]);
  assert.deepEqual(citedIds("night", ["night"]), []);
});

test("context is bounded and does not copy arbitrary transcript payloads", () => {
  const input = Array.from({ length: 30 }, (_, i) => ({ ...signal(String(i), "audio", moment, { transcript: "private raw text" }), summary: "a".repeat(5000) }));
  const selected = selectMomentSignals(input, moment, moment);
  assert.equal(selected.length, 4);
  assert.equal(selected[0].summary.length, 1200);
  assert.ok(!JSON.stringify(selected).includes("private raw text"));
});

test("AI fanout is capped while preserving chronological output order", async () => {
  let active = 0, peak = 0;
  const output = await mapConcurrent([0, 1, 2, 3, 4, 5, 6], 3, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 3 * (7 - value)));
    active--; return value * 2;
  });
  assert.ok(peak <= 3);
  assert.deepEqual(output, [0, 2, 4, 6, 8, 10, 12]);
});
