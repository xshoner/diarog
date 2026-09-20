import { requireDevice, companionError } from "@/lib/companion";
import { db } from "@/lib/supabase";
import { readJsonLimited, signalRows } from "@/lib/signal-validation";

export async function GET(req: Request) {
  try {
    const device = await requireDevice(req);
    const { error } = await db().from("life_signals").select("id").eq("user_id", device.user_id).limit(1);
    return Response.json({ ok: true, deviceId: device.id, protocol: 2,
      capabilities: { signalStorage: !error, summaryConfigured: !!process.env.LETSUR_API_KEY },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return companionError(e); }
}

export async function POST(req: Request) {
  try {
    const device = await requireDevice(req);
    const rows = signalRows(await readJsonLimited(req), device.user_id, device.id);
    // One transaction, all-or-nothing acknowledgement; retries upsert stable external IDs.
    const unique = [...new Map(rows.map((r) => [`${r.source}:${r.external_id}`, r])).values()];
    const { error } = await db().from("life_signals").upsert(unique, { onConflict: "user_id,source,external_id" });
    if (error) throw error;
    return Response.json({ ok: true, count: rows.length });
  } catch (e) { return companionError(e); }
}
