import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("photo assembly supplies Companion context to AI and stores only validated evidence IDs", async t => {
  const signalId = "11111111-1111-4111-8111-111111111111";
  const memoryId = "22222222-2222-4222-8222-222222222222";
  const momentId = "33333333-3333-4333-8333-333333333333";
  let saved: Record<string, unknown> | undefined;
  let analyzed = false;
  let sourceQueries = 0;
  const audits: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const chunks: Buffer[] = []; for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    res.setHeader("Content-Type", "application/json");
    const reply = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if(url.pathname.endsWith("moments")) {
      if(req.method === "POST") { saved = JSON.parse(raw); return reply({ id: momentId }); }
      return reply([]);
    }
    if(url.pathname.endsWith("photos")) return reply(req.method === "GET" ? [{ id: "photo", taken_at: "2026-09-20T03:00:00Z", lat: null, lng: null, gps_source: "none", storage_mid_path: "owner/photo.jpg", is_receipt: false, moment_id: null }] : []);
    if(url.pathname.endsWith("life_signals")) {
      sourceQueries++; assert.equal(url.searchParams.get("user_id"), "eq.owner");
      res.setHeader("Content-Range", "0-0/1");
      return reply([{ id: signalId, source: "audio", occurred_at: "2026-09-20T02:30:00Z", title: "오전 협의", summary: "회의 준비에 관해 통화했다.", payload: { timingSource: "filename" } }]);
    }
    if(url.pathname.endsWith("personal_memories")) {
      assert.equal(url.searchParams.get("user_id"), "eq.owner");
      assert.equal(url.searchParams.get("source_date"), "lte.2026-09-20");
      return reply([{ id: memoryId, kind: "preference", content: "간결한 설명을 선호한다", confidence: 0.9 }]);
    }
    if(url.pathname.endsWith("analytics_events")) { audits.push(JSON.parse(raw)); return reply([]); }
    if(url.pathname.endsWith("usage_ledger") || url.pathname.endsWith("moment_questions")) { res.setHeader("Content-Range", "*/0"); return reply([]); }
    if(url.pathname.startsWith("/storage/")) { res.setHeader("Content-Type", "image/jpeg"); return res.end(Buffer.from([255, 216, 255, 217])); }
    if(url.pathname === "/chat/completions") {
      const messages = JSON.parse(raw).messages;
      const content = messages[1].content[0].text;
      const context = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
      assert.equal(context.companionSignals[0].id, signalId);
      assert.equal(context.personalMemories[0].id, memoryId);
      assert.ok(messages[0].content.includes("같은 사건"));
      analyzed = true;
      return reply({ choices: [{ message: { content: JSON.stringify({ title_candidates: ["오전 기록"], facts: [], inferences: [], used_signal_ids: [signalId, "invented-id"], used_memory_ids: [memoryId] }) } }], usage: {} });
    }
    return reply([]);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-key";
  process.env.LETSUR_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.LETSUR_API_KEY = "fixture-key";
  const { assembleDay } = await import("../src/lib/assemble");
  const result = await assembleDay("owner", "2026-09-20");
  assert.equal(result.moments, 1); assert.equal(result.context?.cited, 1);
  assert.ok(analyzed); assert.equal(sourceQueries, 1);
  const ai = saved?.ai as { context: { suppliedSignalIds: string[]; citedSignalIds: string[]; citedMemoryIds: string[] } };
  assert.deepEqual(ai.context.citedSignalIds, [signalId]);
  assert.deepEqual(ai.context.citedMemoryIds, [memoryId]);
  assert.equal(audits[0].name, "context_assembled");
  assert.equal((audits.at(-1)?.props as { status: string }).status, "completed");
  assert.ok(!JSON.stringify(ai.context).includes("회의 준비"));
});
