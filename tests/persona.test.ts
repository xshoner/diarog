import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("personalization scopes sources to the owner, prioritizes corrections, and surfaces storage failures", async t => {
  let failRead = false, failWrite = false;
  const stored: Record<string, unknown>[] = [];
  const requests: URL[] = [];
  const activity: Array<{ props: { status: string; saved?: number } }> = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost"); requests.push(url);
    const chunks: Buffer[] = []; for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    res.setHeader("Content-Type", "application/json");
    const reply = (data: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    if(url.pathname === "/rest/v1/analytics_events") { activity.push(JSON.parse(body)); return reply([]); }
    if(url.pathname === "/rest/v1/diary_entries") return failRead ? reply({ message: "unavailable" }, 503) : reply([{ date: "2026-09-19", body_final: "짧은 문장이 좋다.", edited: true }]);
    if(url.pathname === "/rest/v1/persona_edits") return reply([{ original: "긴 문장", revised: "짧게." }]);
    if(["/rest/v1/moments", "/rest/v1/life_signals"].includes(url.pathname)) return reply([]);
    if(url.pathname === "/rest/v1/usage_ledger") { res.setHeader("Content-Range", "*/0"); return reply([]); }
    if(url.pathname === "/chat/completions") return reply({ choices: [{ message: { content: JSON.stringify({ memories: [
      { kind: "preference", content: "짧은 문장을 선호한다", confidence: 0.9 },
      { kind: "fact", content: "근거 부족", confidence: 0.2 },
      { kind: "invalid", content: "잘못된 종류", confidence: 1 },
      { kind: "fact", content: "잘못된 수치", confidence: "NaN" },
      null,
    ] }) } }] });
    if(url.pathname === "/embeddings") return reply({ data: [{ embedding: [0, 1] }] });
    if(url.pathname === "/rest/v1/personal_memories") {
      if(req.method === "POST") {
        if(failWrite) return reply({ message: "unavailable" }, 503);
        stored.push(JSON.parse(body)); return reply(null, 201);
      }
      return reply(stored);
    }
    return reply({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-key";
  process.env.LETSUR_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.LETSUR_API_KEY = "fixture-ai-key";
  const { personalWritingContext } = await import("../src/lib/persona-context");
  const { refreshPersonalMemories } = await import("../src/lib/memory");
  const context = await personalWritingContext("owner", "2026-09-20");
  assert.equal(context.diaries[0].userEdited, true);
  assert.equal(context.corrections[0].revised, "짧게.");
  const diaryQuery = requests.find(url => url.pathname.endsWith("diary_entries"))!;
  assert.equal(diaryQuery.searchParams.get("user_id"), "eq.owner");
  assert.equal(diaryQuery.searchParams.get("date"), "lt.2026-09-20");
  assert.equal(requests.find(url => url.pathname.endsWith("persona_edits"))!.searchParams.get("source"), "eq.diary");
  await refreshPersonalMemories("owner", "2026-09-19");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].user_id, "owner");
  assert.equal(stored[0].confidence, 0.9);
  assert.equal(activity.at(-1)?.props.status, "completed");
  assert.equal(activity.at(-1)?.props.saved, 1);
  failWrite = true;
  await assert.rejects(refreshPersonalMemories("owner", "2026-09-19"), /memory save failed/);
  assert.equal(activity.at(-1)?.props.status, "failed");
  failRead = true;
  await assert.rejects(personalWritingContext("owner", "2026-09-20"), /unavailable/);
  await assert.rejects(refreshPersonalMemories("owner", "2026-09-19"), /unavailable/);
});
