// Run after npm run build. Exercises actual Next.js cookies and route handlers.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { SignJWT } from "jose";

const queries = [];
const fixtureMomentId = "33333333-3333-4333-8333-333333333333";
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture"); queries.push({ method: req.method, url });
  for await (const chunk of req) { void chunk; }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Range", "*/1");
  let value = [];
  if(url.pathname.endsWith("users_profile")) value = { user_id: "fixture-owner", persona_type: "plain" };
  if(url.pathname.endsWith("personal_memories") && req.method === "GET") value = [{ id: "11111111-1111-4111-8111-111111111111", content: "짧은 글을 선호한다", confidence: 0.9 }];
  if(url.pathname.endsWith("diary_entries")) value = [{ date: "2026-09-19", edited: true }];
  if(url.pathname.endsWith("moments")) value = url.searchParams.get("id") === `eq.${fixtureMomentId}` ? {
    ai: { context: { suppliedSignalIds: ["22222222-2222-4222-8222-222222222222"], suppliedMemoryIds: ["11111111-1111-4111-8111-111111111111"] } },
  } : null;
  if(url.pathname.endsWith("life_signals")) value = [{ id: "22222222-2222-4222-8222-222222222222", source: "audio", title: "fixture", summary: "회의 준비 통화" }];
  res.end(JSON.stringify(value));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const secret = "local-fixture-only-not-a-production-secret";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  windowsHide: true, stdio: "ignore", env: { ...process.env, AUTH_SECRET: secret,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixture.address().port}`, SUPABASE_SERVICE_ROLE_KEY: "fixture-key" },
});
try {
  let started = false;
  for(let i = 0; i < 60; i++) {
    try { await fetch(`${origin}/api/version`); started = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(started, "local Next.js server started");
  assert.equal((await fetch(`${origin}/api/persona`)).status, 401);
  assert.equal((await fetch(`${origin}/api/context?momentId=${fixtureMomentId}`)).status, 401);
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("fixture-owner").setExpirationTime("5m").sign(new TextEncoder().encode(secret));
  const headers = { cookie: `diarog_session=${token}`, "content-type": "application/json", origin };
  const response = await fetch(`${origin}/api/persona`, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).memories.length, 1);
  assert.equal((await fetch(`${origin}/persona`, { headers })).status, 200);
  const preserved = await fetch(`${origin}/api/days/2026-09-19/confirm`, {
    method: "POST", headers, body: JSON.stringify({ preserveExisting: true }),
  });
  assert.equal(preserved.status, 200);
  assert.equal((await preserved.json()).skipped, true);
  assert.equal(queries.filter(q => q.method === "POST" && q.url.pathname.endsWith("diary_entries")).length, 0);
  assert.equal((await fetch(`${origin}/api/context?momentId=bad`, { headers })).status, 400);
  assert.equal((await fetch(`${origin}/api/context?momentId=44444444-4444-4444-8444-444444444444`, { headers })).status, 404);
  const context = await fetch(`${origin}/api/context?momentId=${fixtureMomentId}`, { headers });
  assert.equal(context.status, 200);
  assert.equal((await context.json()).signals.length, 1);
  const body = JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", user_id: "another-owner" });
  assert.equal((await fetch(`${origin}/api/persona`, { method: "DELETE", headers: { ...headers, origin: "https://attacker.invalid" }, body })).status, 403);
  assert.equal((await fetch(`${origin}/api/persona`, { method: "DELETE", headers, body: "null" })).status, 400);
  assert.equal((await fetch(`${origin}/api/persona`, { method: "DELETE", headers, body })).status, 200);
  const removal = queries.find(q => q.method === "DELETE");
  assert.equal(removal.url.searchParams.get("user_id"), "eq.fixture-owner");
  assert.equal(removal.url.searchParams.get("id"), "eq.11111111-1111-4111-8111-111111111111");
  assert.ok(queries.filter(q => ["personal_memories", "persona_edits", "diary_entries", "moments", "life_signals", "analytics_events"].some(table => q.url.pathname.endsWith(table))).every(q => q.url.searchParams.get("user_id") === "eq.fixture-owner"));
  console.log("PASS: Next.js persona/context APIs, session auth, same-origin protection and owner-scoped reads/deletes");
} finally {
  child.kill();
  await new Promise(resolve => fixture.close(resolve));
}
