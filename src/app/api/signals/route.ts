import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

const SOURCES = new Set(["audio","email","steps","location","calendar","photo","manual","device"]);

export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const body = await req.json();
    const items = Array.isArray(body?.signals) ? body.signals : [body];
    const rows = items.slice(0, 200).flatMap((s: Record<string, unknown>) => {
      const source = typeof s.source === "string" ? s.source : "";
      const occurredAt = typeof s.occurredAt === "string" ? s.occurredAt : "";
      if (!SOURCES.has(source) || !occurredAt || isNaN(Date.parse(occurredAt))) return [];
      return [{
        user_id: profile.user_id,
        source,
        occurred_at: new Date(occurredAt).toISOString(),
        ended_at: typeof s.endedAt === "string" && !isNaN(Date.parse(s.endedAt)) ? new Date(s.endedAt).toISOString() : null,
        title: typeof s.title === "string" ? s.title.slice(0, 300) : null,
        summary: typeof s.summary === "string" ? s.summary.slice(0, 8000) : null,
        payload: s.payload && typeof s.payload === "object" ? s.payload : {},
        external_id: typeof s.externalId === "string" ? s.externalId.slice(0, 500) : null,
      }];
    });
    if (!rows.length) return Response.json({ error: "no valid signals" }, { status: 400 });

    for (const row of rows) {
      if (row.external_id) {
        await db().from("life_signals").upsert(row, { onConflict: "user_id,source,external_id" });
      } else {
        await db().from("life_signals").insert(row);
      }
    }
    return Response.json({ ok: true, count: rows.length });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { profile } = await requireUser();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    let q = db().from("life_signals")
      .select("id, source, occurred_at, ended_at, title, summary, payload, external_id")
      .eq("user_id", profile.user_id)
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (from && !isNaN(Date.parse(from))) q = q.gte("occurred_at", new Date(from).toISOString());
    if (to && !isNaN(Date.parse(to))) q = q.lt("occurred_at", new Date(to).toISOString());
    const { data } = await q;
    return Response.json({ signals: data ?? [] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
