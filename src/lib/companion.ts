import { createHash } from "node:crypto";
import { db } from "./supabase";
import { UnauthorizedError, unauthorizedResponse } from "./session";
import { InputError } from "./signal-validation";

export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

// Device credentials deliberately do not work with general account/diary APIs.
export async function requireDevice(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer dcp_[A-Za-z0-9_-]{43}$/.test(auth)) throw new UnauthorizedError();
  const { data, error } = await db().from("companion_devices")
    .select("id,user_id,expires_at,revoked_at")
    .eq("token_hash", hashToken(auth.slice(7))).maybeSingle();
  if (error) throw new Error("device lookup failed");
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) throw new UnauthorizedError();
  const { error: updateError } = await db().from("companion_devices")
    .update({ last_seen_at: new Date().toISOString() }).eq("id", data.id).eq("user_id", data.user_id);
  if (updateError) throw new Error("device update failed");
  return data as { id: string; user_id: string };
}

export function sameOrigin(req: Request) {
  const raw = req.headers.get("origin");
  let origin: URL;
  try { origin = new URL(raw ?? ""); } catch { throw new InputError("same-origin request required", 403); }
  // Next.js may construct req.url from its internal hostname behind a proxy.
  // The browser's Host is the public authority used for cookie/origin isolation.
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(req.url).protocol.slice(0, -1);
  if (raw !== origin.origin || !["https:", "http:"].includes(origin.protocol) || origin.host !== host || origin.protocol !== `${protocol}:`) {
    throw new InputError("same-origin request required", 403);
  }
}

export function companionError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "companion service unavailable; retry later" }, { status: 503 });
}
