import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, readJsonLimited, signalRows, timestamp } from "../src/lib/signal-validation";
import { audioSummary } from "../src/lib/audio-summary";

const steps = { source: "steps", occurredAt: "2026-01-01T00:00:00+09:00", externalId: "steps:2026-01-01", payload: { count: 8420 } };

test("AI output errors stay retryable and structured summaries are bounded", () => {
  for (const value of [null, [], "text", { summary: " " }]) {
    assert.throws(() => audioSummary(value), (e: unknown) => e instanceof Error && !(e instanceof InputError));
  }
  const result = audioSummary({ title: "x".repeat(400), summary: "y".repeat(9000), people: [null, 1, "  이름  "], todos: Array(40).fill("z".repeat(600)) });
  assert.equal(result.title.length, 300); assert.equal(result.summary.length, 8000);
  assert.deepEqual(result.fields.people, ["이름"]); assert.equal(result.fields.todos.length, 20); assert.equal(result.fields.todos[0].length, 500);
});

test("device identity is server-bound and retries have stable scoped IDs", () => {
  const [a] = signalRows({ ...steps, user_id: "attacker", deviceId: "other" }, "owner", "phone");
  const [retry] = signalRows(steps, "owner", "phone");
  const [other] = signalRows(steps, "owner", "other-phone");
  assert.equal(a.user_id, "owner"); assert.equal(a.external_id, retry.external_id);
  assert.notEqual(a.external_id, other.external_id);
  assert.equal(a.occurred_at, "2025-12-31T15:00:00.000Z");
});

test("batch validation is atomic and does not silently drop invalid signals", () => {
  for (const signals of [[], Array(201).fill(steps), [steps, null], [steps, { ...steps, source: "email" }]]) {
    assert.throws(() => signalRows({ signals }, "owner", "phone"), InputError);
  }
});

test("device signals require safe counts, coordinates and external IDs", () => {
  for (const count of [-1, 1.5, 200001, "20", NaN]) assert.throws(() => signalRows({ ...steps, payload: { count } }, "u", "d"), InputError);
  assert.throws(() => signalRows({ ...steps, externalId: undefined }, "u", "d"), InputError);
  assert.throws(() => signalRows({ ...steps, source: "audio" }, "u", "d"), InputError);
  for (const payload of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: "37", lng: 127 }, { lat: NaN, lng: 0 }]) {
    assert.throws(() => signalRows({ ...steps, source: "location", payload }, "u", "d"), InputError);
  }
  assert.equal(signalRows({ ...steps, source: "location", payload: { lat: 0, lng: 0 } }, "u", "d").length, 1);
});

test("timestamps reject missing timezones, reverse intervals and future events", () => {
  assert.throws(() => timestamp("2026-01-01T00:00:00"), InputError);
  assert.throws(() => timestamp("not-a-date"), InputError);
  assert.throws(() => timestamp("2026-02-30T01:00:00Z"), InputError);
  assert.throws(() => timestamp("2026-01-01T24:00:00Z"), InputError);
  assert.throws(() => timestamp(new Date(Date.now() + 600_000).toISOString()), InputError);
  assert.throws(() => signalRows({ ...steps, endedAt: "2025-01-01T00:00:00Z" }, "u", "d"), InputError);
});

test("streamed request limits are enforced even without Content-Length", async () => {
  const make = (body: string) => new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.deepEqual(await readJsonLimited(make('{"ok":true}'), 20), { ok: true });
  await assert.rejects(readJsonLimited(make('{"data":"' + "x".repeat(200) + '"}'), 20), (e: unknown) => e instanceof InputError && e.status === 413);
  await assert.rejects(readJsonLimited(make("bad json")), InputError);
  await assert.rejects(readJsonLimited(new Request("https://example.com", { method: "POST", body: "{}" })), (e: unknown) => e instanceof InputError && e.status === 415);
});
