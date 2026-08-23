import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let _admin: SupabaseClient | null = null;

/** 서버 전용 service_role 클라이언트 (RLS 우회 — 모든 쿼리에 user_id 스코핑 필수) */
export function db(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export const PHOTO_BUCKET = "photos";

/** 비공개 photos 버킷 보장 (최초 1회) */
export async function ensurePhotoBucket(): Promise<void> {
  const s = db().storage;
  const { data } = await s.getBucket(PHOTO_BUCKET);
  if (!data) {
    await s.createBucket(PHOTO_BUCKET, {
      public: false,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/webp", "image/png"],
    });
  }
}

/** 서명 URL 일괄 생성 (1시간) */
export async function signPaths(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await db().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
