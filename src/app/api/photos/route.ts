import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, PHOTO_BUCKET, ensurePhotoBucket } from "@/lib/supabase";

export const maxDuration = 60;

// POST /api/photos — 다운스케일본+썸네일+메타 업로드 (FR-2.1, FR-2.2)
// FormData: mid(File), thumb(File), meta(JSON string: {takenAt, timeConfidence, lat, lng, isReceipt, exif})
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const form = await req.formData();
    const mid = form.get("mid") as File | null;
    const thumb = form.get("thumb") as File | null;
    const metaRaw = form.get("meta") as string | null;
    if (!mid || !thumb || !metaRaw) return Response.json({ error: "missing fields" }, { status: 400 });
    if (mid.size > 4 * 1024 * 1024) return Response.json({ error: "file too large" }, { status: 413 });

    const meta = JSON.parse(metaRaw) as {
      takenAt?: string; timeConfidence?: string; lat?: number | null; lng?: number | null;
      isReceipt?: boolean; exif?: Record<string, unknown>;
    };
    const takenAt = meta.takenAt && !isNaN(Date.parse(meta.takenAt))
      ? new Date(meta.takenAt) : new Date();

    await ensurePhotoBucket().catch(() => {});

    const id = crypto.randomUUID();
    const day = takenAt.toISOString().slice(0, 10);
    const midPath = `${userId}/${day}/${id}_mid.jpg`;
    const thumbPath = `${userId}/${day}/${id}_thumb.jpg`;

    const storage = db().storage.from(PHOTO_BUCKET);
    const [u1, u2] = await Promise.all([
      storage.upload(midPath, mid, { contentType: mid.type || "image/jpeg" }),
      storage.upload(thumbPath, thumb, { contentType: thumb.type || "image/jpeg" }),
    ]);
    if (u1.error || u2.error) {
      return Response.json({ error: u1.error?.message || u2.error?.message }, { status: 500 });
    }

    const hasGps = typeof meta.lat === "number" && typeof meta.lng === "number";
    const { data: row, error } = await db().from("photos").insert({
      id,
      user_id: userId,
      taken_at: takenAt.toISOString(),
      time_confidence: meta.timeConfidence === "file" ? "file" : meta.timeConfidence === "unknown" ? "unknown" : "exif",
      lat: hasGps ? meta.lat : null,
      lng: hasGps ? meta.lng : null,
      gps_source: hasGps ? "exif" : "none",
      storage_mid_path: midPath,
      storage_thumb_path: thumbPath,
      exif_raw: meta.exif ?? null,
      is_receipt: !!meta.isReceipt,
    }).select("id").single();
    if (error || !row) return Response.json({ error: error?.message }, { status: 500 });

    await db().from("analytics_events").insert({ user_id: userId, name: "photos_uploaded", props: { count: 1 } });
    return Response.json({ id: row.id, takenAt: takenAt.toISOString() });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
