import { env } from "./env";
import { db } from "./supabase";

// Letsur 게이트웨이 (OpenAI 호환) — 제품 헌법 ⑧ AI 단일 창구
// gemini-3.7-flash는 reasoning 토큰을 소모하므로 max_tokens를 넉넉히 잡는다.

type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

interface CallOptions {
  userId?: string;
  kind: "call1" | "call2" | "call3" | "call4" | "embed";
  temperature?: number;
  maxTokens?: number;
}

const DAILY_CALL_LIMIT = 25; // FR 비용 가드: 사용자·일당 상한

export class AiLimitError extends Error {
  constructor() { super("daily ai call limit exceeded"); }
}

async function checkDailyLimit(userId: string | undefined): Promise<void> {
  if (!userId) return;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { count } = await db()
    .from("usage_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("date", today)
    .neq("kind", "embed");
  if ((count ?? 0) >= DAILY_CALL_LIMIT) throw new AiLimitError();
}

async function logUsage(opts: CallOptions, model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, ok: boolean, latencyMs: number) {
  try {
    const tin = usage?.prompt_tokens ?? 0;
    const tout = usage?.completion_tokens ?? 0;
    await db().from("usage_ledger").insert({
      user_id: opts.userId ?? null,
      kind: opts.kind,
      model,
      tokens_in: tin,
      tokens_out: tout,
      est_cost: tin * 3e-7 + tout * 2.5e-6, // gemini-3.7-flash 추정 단가
      ok,
      latency_ms: latencyMs,
    });
  } catch { /* 로깅 실패는 무시 */ }
}

async function chatOnce(messages: ChatMessage[], temperature: number, maxTokens: number): Promise<{ text: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const res = await fetch(`${env.letsurBase()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.letsurKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.letsurModel(),
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`letsur ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const text: string = json.choices?.[0]?.message?.content ?? "";
  return { text, usage: json.usage };
}

function extractJson(text: string): unknown {
  // 코드펜스/부가 텍스트 제거 후 첫 JSON 블록 파싱
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("no json in response");
  // 괄호 균형으로 끝 위치 탐색
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced json");
}

/**
 * JSON 강제 호출: 파싱 실패 시 temperature 하향 1회 재시도 (§8.1 신뢰성 규칙)
 */
export async function chatJSON<T>(messages: ChatMessage[], opts: CallOptions): Promise<T> {
  await checkDailyLimit(opts.userId);
  const model = env.letsurModel();
  const temps = [opts.temperature ?? 0.4, 0.1];
  let lastErr: unknown;
  for (const t of temps) {
    const started = Date.now();
    try {
      const { text, usage } = await chatOnce(messages, t, opts.maxTokens ?? 4000);
      const parsed = extractJson(text) as T;
      await logUsage(opts, model, usage, true, Date.now() - started);
      return parsed;
    } catch (e) {
      lastErr = e;
      await logUsage(opts, model, undefined, false, Date.now() - started);
    }
  }
  throw lastErr;
}

/** 임베딩 (text-embedding-3-small, 1536차원) */
export async function embed(text: string, userId?: string): Promise<number[]> {
  const started = Date.now();
  const res = await fetch(`${env.letsurBase()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.letsurKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: env.letsurEmbeddingModel(), input: text.slice(0, 6000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`letsur embeddings ${res.status}`);
  const json = await res.json();
  await logUsage({ kind: "embed", userId }, env.letsurEmbeddingModel(), json.usage, true, Date.now() - started);
  return json.data[0].embedding as number[];
}
