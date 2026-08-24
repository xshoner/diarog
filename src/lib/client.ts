"use client";

// 클라이언트 공용: API fetch + 사진 처리 (EXIF 파싱, 다운스케일)

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ProcessedPhoto {
  mid: Blob;
  thumb: Blob;
  meta: {
    takenAt: string;
    timeConfidence: "exif" | "file" | "unknown";
    lat: number | null;
    lng: number | null;
    gpsSource: "exif" | "device" | null;
    hash: string | null;
    isReceipt: boolean;
    exif: Record<string, unknown>;
  };
}

export type GeoReason = "ok" | "denied" | "timeout" | "unavailable" | "unsupported";

/** 현재 기기 위치 + 실패 사유 — 안드로이드 포토 피커가 위치 EXIF를 제거하는 경우의 폴백 */
export async function requestDeviceLocation(): Promise<{ loc: { lat: number; lng: number } | null; reason: GeoReason }> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return { loc: null, reason: "unsupported" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ loc: { lat: p.coords.latitude, lng: p.coords.longitude }, reason: "ok" }),
      (err) => resolve({
        loc: null,
        reason: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable",
      }),
      // GPS 콜드스타트·권한 팝업 대기를 고려해 넉넉히
      { timeout: 20000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

export async function getDeviceLocation(): Promise<{ lat: number; lng: number } | null> {
  return (await requestDeviceLocation()).loc;
}

const DEVICE_GPS_WINDOW_MS = 12 * 3600 * 1000; // 촬영 12시간 이내 사진만 현재 위치로 대체

/** 파일 → EXIF 추출(다운스케일 전, FR-2.2) + 1024px/320px 리사이즈 (FR-2.1) */
export async function processPhoto(
  file: File,
  isReceipt = false,
  deviceLoc: { lat: number; lng: number } | null = null,
): Promise<ProcessedPhoto> {
  const exifr = (await import("exifr")).default;
  let takenAt: string;
  let timeConfidence: "exif" | "file" | "unknown" = "exif";
  let lat: number | null = null;
  let lng: number | null = null;
  let gpsSource: "exif" | "device" | null = null;
  const exif: Record<string, unknown> = {};

  try {
    const parsed = await exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "Orientation", "Make", "Model"] });
    const dt: Date | undefined = parsed?.DateTimeOriginal ?? parsed?.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      takenAt = dt.toISOString();
    } else {
      takenAt = new Date(file.lastModified).toISOString();
      timeConfidence = "file"; // low_time_confidence 폴백
    }
    const gps = await exifr.gps(file).catch(() => null);
    if (gps && typeof gps.latitude === "number") {
      lat = gps.latitude;
      lng = gps.longitude;
      gpsSource = "exif";
    }
    if (parsed?.Make) exif.make = parsed.Make;
    if (parsed?.Model) exif.model = parsed.Model;
  } catch {
    takenAt = new Date(file.lastModified).toISOString();
    timeConfidence = "file";
  }

  const bitmap = await createImageBitmap(file).catch(async () => {
    // HEIC 등 미지원 포맷 → img 엘리먼트 폴백
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // EXIF에 GPS가 없으면(포토 피커의 위치 제거 등) 최근 촬영분에 한해 현재 기기 위치로 대체
  if (lat == null && deviceLoc && Math.abs(Date.now() - Date.parse(takenAt)) <= DEVICE_GPS_WINDOW_MS) {
    lat = deviceLoc.lat;
    lng = deviceLoc.lng;
    gpsSource = "device";
  }

  // 원본 파일 SHA-256 — 동일 사진 재업로드 중복 방지 키
  let hash: string | null = null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { /* http 환경 등 subtle 미지원 시 중복 검사 생략 */ }

  const mid = await resize(bitmap, 1024);
  const thumb = await resize(bitmap, 320);
  bitmap.close();

  return { mid, thumb, meta: { takenAt, timeConfidence, lat, lng, gpsSource, hash, isReceipt, exif } };
}

async function resize(bitmap: ImageBitmap, maxDim: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.82)
  );
}

export async function uploadPhoto(p: ProcessedPhoto): Promise<{ id: string; duplicate?: boolean }> {
  const form = new FormData();
  form.append("mid", p.mid, "mid.jpg");
  form.append("thumb", p.thumb, "thumb.jpg");
  form.append("meta", JSON.stringify(p.meta));
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 웹푸시 구독 (FR-1.4) */
export async function subscribePush(vapidPublicKey: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
