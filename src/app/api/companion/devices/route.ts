import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/supabase";
import { companionError, hashToken, sameOrigin } from "@/lib/companion";
import { InputError, object, readJsonLimited, text } from "@/lib/signal-validation";

export async function GET() {
  try {
    const { session } = await requireUser();
    const { data, error } = await db().from("companion_devices")
      .select("id,name,created_at,expires_at,revoked_at,last_seen_at").eq("user_id", session.userId)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return Response.json({ devices: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return companionError(e); }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { session } = await requireUser();
    const body = object(await readJsonLimited(req, 1024));
    const name = text(body.name, "name", 80);
    const { count, error: countError } = await db().from("companion_devices")
      .select("id", { count: "exact", head: true }).eq("user_id", session.userId)
      .is("revoked_at", null).gt("expires_at", new Date().toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= 20) throw new InputError("기기를 먼저 연결 해제해 주세요", 409);
    const token = `dcp_${randomBytes(32).toString("base64url")}`;
    const { data, error } = await db().from("companion_devices")
      .insert({ user_id: session.userId, name, token_hash: hashToken(token) })
      .select("id,name,expires_at").single();
    if (error) throw error;
    return Response.json({ device: data, token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return companionError(e); }
}

export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const { session } = await requireUser();
    const { id } = object(await readJsonLimited(req, 1024));
    if (typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id)) throw new InputError("invalid device id");
    const { error } = await db().from("companion_devices").update({ revoked_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", session.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) { return companionError(e); }
}
