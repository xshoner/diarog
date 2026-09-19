import { requireUser } from "@/lib/session";
import { db } from "@/lib/supabase";
import { companionError, sameOrigin } from "@/lib/companion";
import { InputError, object, readJsonLimited, signalRows } from "@/lib/signal-validation";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { session } = await requireUser();
    const rows = signalRows(await readJsonLimited(req), session.userId);
    const { error } = await db().from("life_signals").upsert(rows, { onConflict: "user_id,source,external_id" });
    if (error) throw error;
    return Response.json({ ok: true, count: rows.length });
  } catch (e) { return companionError(e); }
}

export async function GET(req: Request) {
  try {
    const { session } = await requireUser();
    const url = new URL(req.url);
    let q = db().from("life_signals")
      .select("id,source,occurred_at,ended_at,title,summary,payload,external_id")
      .eq("user_id", session.userId).order("occurred_at", { ascending: false }).limit(500);
    for (const key of ["from", "to"]) {
      const value = url.searchParams.get(key);
      if (!value) continue;
      if (!Number.isFinite(Date.parse(value))) throw new InputError("invalid date range");
      q = key === "from" ? q.gte("occurred_at", new Date(value).toISOString()) : q.lt("occurred_at", new Date(value).toISOString());
    }
    const { data, error } = await q;
    if (error) throw error;
    return Response.json({ signals: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return companionError(e); }
}

export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const { session } = await requireUser();
    const body = object(await readJsonLimited(req, 1024));
    if (typeof body.id !== "string" || !/^[\da-f-]{36}$/i.test(body.id)) throw new InputError("invalid id");
    const { error } = await db().from("life_signals").delete().eq("user_id", session.userId).eq("id", body.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) { return companionError(e); }
}
