import { derivedSecret, derivedVapidKeys } from "./derived";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  letsurKey: () => req("LETSUR_API_KEY"),
  letsurBase: () => process.env.LETSUR_API_BASE_URL || "https://gw.letsur.ai/v1",
  letsurModel: () => process.env.LETSUR_MODEL || "gemini-3.7-flash",
  letsurEmbeddingModel: () => process.env.LETSUR_EMBEDDING_MODEL || "text-embedding-3-small",
  googleClientId: () => req("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => req("GOOGLE_CLIENT_SECRET"),
  kakaoRestKey: () => req("KAKAO_REST_API_KEY"),
  kmaKey: () => req("KMA_SERVICE_KEY"),
  authSecret: () => process.env.AUTH_SECRET || derivedSecret("auth-session"),
  vapidPublic: () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || derivedVapidKeys().publicKey,
  vapidPrivate: () => process.env.VAPID_PRIVATE_KEY || derivedVapidKeys().privateKey,
  cronSecret: () => process.env.CRON_SECRET || derivedSecret("cron"),
};
