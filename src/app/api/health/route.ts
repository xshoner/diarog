import { db } from "@/lib/supabase";
import { env } from "@/lib/env";

// 운영 진단: 환경변수 존재 여부(boolean만), DB 스키마 적용 여부, 서비스키 role
export async function GET() {
  const has = (k: string) => !!process.env[k];

  let serviceKeyRole: string | null = null;
  try {
    const key = env.supabaseServiceKey();
    if (key.startsWith("eyJ")) {
      serviceKeyRole = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString()).role ?? null;
    } else if (key.startsWith("sb_secret_")) {
      serviceKeyRole = "secret_key";
    }
  } catch { /* ignore */ }

  let dbStatus = "unknown";
  try {
    const { error } = await db().from("users_profile").select("user_id", { head: true, count: "exact" });
    dbStatus = error ? `error: ${error.message}` : "ok";
  } catch (e) {
    dbStatus = `unreachable: ${String(e).slice(0, 100)}`;
  }

  let bucketStatus = "unknown";
  try {
    const { data } = await db().storage.getBucket("photos");
    bucketStatus = data ? "ok" : "missing";
  } catch {
    bucketStatus = "error";
  }

  return Response.json({
    ok: dbStatus === "ok" && bucketStatus === "ok" && serviceKeyRole === "service_role",
    db: dbStatus,
    storage: bucketStatus,
    serviceKeyRole,
    env: {
      letsur: has("LETSUR_API_KEY"),
      googleOAuth: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"),
      kakaoRest: has("KAKAO_REST_API_KEY"),
      kma: has("KMA_SERVICE_KEY"),
      supabaseService: has("SUPABASE_SERVICE_ROLE_KEY"),
      authSecretExplicit: has("AUTH_SECRET"),
      vapidExplicit: has("VAPID_PRIVATE_KEY"),
      cronSecretExplicit: has("CRON_SECRET"),
    },
  });
}
