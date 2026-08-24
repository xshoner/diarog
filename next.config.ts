import type { NextConfig } from "next";
import crypto from "crypto";

// 공개 가능한 클라이언트 키의 기본값 (비밀키는 절대 여기 두지 않는다 — Vercel env 전용)
const isVercelProd = process.env.VERCEL_ENV === "production";

// VAPID 공개키: env 미설정 시 SUPABASE_SERVICE_ROLE_KEY에서 결정론적 파생
// (src/lib/derived.ts와 동일 로직 — 서버 개인키와 짝이 맞아야 함)
function derivedVapidPublic(): string {
  const seedValue = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "diarog-dev-seed";
  const ecdh = crypto.createECDH("prime256v1");
  for (let i = 0; ; i++) {
    const d = crypto.createHmac("sha256", seedValue).update(`diarog:vapid:${i}`).digest();
    try {
      ecdh.setPrivateKey(d);
      break;
    } catch { /* rehash */ }
  }
  return ecdh.getPublicKey().toString("base64url");
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ??
      (isVercelProd ? "https://diarog.vercel.app" : "http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://okrecbetvcdglnjlprqj.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      "sb_publishable__K6GjS2rSOrU_hU2_w8J2A_DZY1KhhB",
    NEXT_PUBLIC_KAKAO_MAP_JS_KEY:
      process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY ?? "ff4036aee9eefccc9fc989155567d3e0",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? derivedVapidPublic(),
    // 빌드 시점의 커밋 SHA — 스테일 번들 감지(UpdateNotice)용
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
