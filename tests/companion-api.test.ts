import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

test("companion API enforces auth/revocation, persistence acknowledgements, idempotency and transcript minimization", async (t) => {
  const credential = "dcp_" + "a".repeat(43);
  const hash = createHash("sha256").update(credential).digest("hex");
  let revoked = false, expired = false, writeFails = false, lookupFails = false, aiCalls = 0;
  const stored = new Map<string, Record<string, unknown>>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    res.setHeader("Content-Type", "application/json");
    const reply = (data: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    if (url.pathname === "/rest/v1/companion_devices") {
      if (lookupFails) return reply({ message: "test unavailable" }, 503);
      if (req.method === "PATCH") return reply([]);
      return reply(url.searchParams.get("token_hash") === `eq.${hash}` ? [{
        id: "phone-1", user_id: "owner-1", expires_at: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(), revoked_at: revoked ? new Date().toISOString() : null,
      }] : []);
    }
    if (url.pathname === "/rest/v1/life_signals") {
      if (req.method === "POST") {
        if (writeFails) return reply({ message: "test unavailable" }, 503);
        const parsed = JSON.parse(body);
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) stored.set(`${row.user_id}:${row.source}:${row.external_id}`, row);
        return reply(null, 201);
      }
      const found = stored.get(`${url.searchParams.get("user_id")?.slice(3)}:${url.searchParams.get("source")?.slice(3)}:${url.searchParams.get("external_id")?.slice(3)}`);
      return reply(found ? [{ id: "existing-signal" }] : []);
    }
    if (url.pathname === "/rest/v1/usage_ledger") { res.setHeader("Content-Range", "*/0"); return reply([]); }
    if (url.pathname === "/chat/completions") {
      aiCalls++;
      return reply({ choices: [{ message: { content: JSON.stringify({ title: "협의", summary: "다음 주 미팅을 협의했다.", people: [], topics: ["프로젝트"], promises: ["다음 주 미팅"], todos: ["일정 확인"] }) } }], usage: {} });
    }
    return reply({ error: "unexpected fixture route" }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
  process.env.LETSUR_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.LETSUR_API_KEY = "fixture-ai-key";
  const signals = await import("../src/app/api/companion/signals/route");
  const transcripts = await import("../src/app/api/companion/transcripts/route");
  const request = (body?: unknown, token: string | null = credential) => new Request("https://diarog.test/api/companion/signals", {
    method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await signals.GET(request(undefined, null))).status, 401);
  assert.equal((await signals.GET(request(undefined, "dcp_" + "b".repeat(43)))).status, 401);
  assert.equal((await signals.GET(request())).status, 200);
  revoked = true; assert.equal((await signals.GET(request())).status, 401); revoked = false;
  expired = true; assert.equal((await signals.GET(request())).status, 401); expired = false;
  lookupFails = true; assert.equal((await signals.GET(request())).status, 503); lookupFails = false;

  const body = { source: "steps", occurredAt: "2026-01-01T00:00:00+09:00", externalId: "steps:2026-01-01", payload: { count: 1234 }, user_id: "other-owner" };
  writeFails = true; assert.equal((await signals.POST(request(body))).status, 503); assert.equal(stored.size, 0); writeFails = false;
  assert.equal((await signals.POST(request(body))).status, 200);
  assert.equal((await signals.POST(request({ ...body, payload: { count: 2345 } }))).status, 200);
  assert.equal(stored.size, 1);
  assert.equal([...stored.values()][0].user_id, "owner-1");
  assert.deepEqual([...stored.values()][0].payload, { count: 2345 });
  assert.equal((await signals.POST(request({ ...body, source: "email" }))).status, 400);
  assert.equal((await signals.POST(request({ signals: [body, null] }))).status, 400);
  assert.equal(stored.size, 1);

  const call = { externalId: "audio:hash", occurredAt: "2026-01-01T01:00:00Z", endedAt: "2026-01-01T01:10:00Z", transcript: "원문을 보관하지 않는지 확인하는 테스트 전사문", timingSource: "filename" };
  assert.equal((await transcripts.POST(request(call))).status, 200);
  assert.equal(aiCalls, 1); assert.equal(stored.size, 2);
  assert.ok(!JSON.stringify([...stored.values()]).includes(call.transcript));
  assert.equal((await transcripts.POST(request(call))).status, 200);
  assert.equal(aiCalls, 1); assert.equal(stored.size, 2);
  revoked = true;
  assert.equal((await transcripts.POST(request({ ...call, externalId: "audio:other" }))).status, 401);
  assert.equal(aiCalls, 1);
});
