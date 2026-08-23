import type { NextConfig } from "next";

// 공개 가능한 클라이언트 키의 기본값 (비밀키는 절대 여기 두지 않는다 — Vercel env 전용)
const isVercelProd = process.env.VERCEL_ENV === "production";

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
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
      "BPLEmzlT-En6wGuPfNn5Apa_23JY7bEtMKLPipjvL1_lsSEEq0_AgqTiqU6FiD32ivYmlZf8p4rJVbogibBw_mY",
  },
};

export default nextConfig;
