export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readJsonLimited(req: Request, maxBytes = 256_000): Promise<unknown> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new InputError("JSON required", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new InputError("empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new InputError("request too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new InputError("invalid JSON"); }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("object required");
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new InputError(`invalid ${field}`);
  return value.trim();
}

export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new InputError("ISO timestamp with timezone required");
  }
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new InputError("invalid calendar date");
  if (Date.parse(value) > Date.now() + 300_000) throw new InputError("future timestamp");
  return new Date(value).toISOString();
}

export function signalRows(value: unknown, userId: string, deviceId?: string) {
  const body = object(value);
  const items = Array.isArray(body.signals) ? body.signals : [body];
  if (!items.length || items.length > 200) throw new InputError("1–200 signals required");
  const sources = deviceId ? ["steps", "location"] : ["audio", "email", "steps", "location", "calendar", "photo", "manual", "device"];
  return items.map((item) => {
    const s = object(item);
    if (!sources.includes(String(s.source))) throw new InputError("invalid source");
    const occurredAt = timestamp(s.occurredAt);
    const endedAt = s.endedAt == null ? null : timestamp(s.endedAt);
    if (endedAt && endedAt < occurredAt) throw new InputError("end before start");
    const payload = s.payload == null ? {} : object(s.payload);
    if (JSON.stringify(payload).length > 16_000) throw new InputError("payload too large");
    if (deviceId && s.source === "steps" && (!Number.isSafeInteger(payload.count) || Number(payload.count) < 0 || Number(payload.count) > 200_000)) throw new InputError("invalid step count");
    if (deviceId && s.source === "location" &&
      !(typeof payload.lat === "number" && Math.abs(payload.lat) <= 90 && typeof payload.lng === "number" && Math.abs(payload.lng) <= 180)) throw new InputError("invalid coordinates");
    const externalId = s.externalId == null && !deviceId ? null : text(s.externalId, "externalId", 400);
    return {
      user_id: userId, source: String(s.source), occurred_at: occurredAt, ended_at: endedAt,
      title: s.title == null ? null : text(s.title, "title", 300),
      summary: s.summary == null ? null : text(s.summary, "summary", 8000),
      payload, external_id: deviceId ? `companion:${deviceId}:${externalId}` : externalId,
    };
  });
}
