import crypto from "crypto";

// 환경변수 누락 시 SUPABASE_SERVICE_ROLE_KEY(서버 전용 비밀)에서 결정론적으로
// 파생시키는 폴백. Vercel env에 개별 시크릿을 추가하지 않아도 동작하게 한다.
// 값이 명시돼 있으면 항상 명시값이 우선한다.

function seed(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "diarog-dev-seed";
}

export function derivedSecret(purpose: string): string {
  return crypto.createHmac("sha256", seed()).update(`diarog:${purpose}`).digest("base64url");
}

/** P-256 VAPID 키쌍을 시드에서 결정론적으로 생성 */
export function derivedVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  for (let i = 0; ; i++) {
    const d = crypto.createHmac("sha256", seed()).update(`diarog:vapid:${i}`).digest();
    try {
      ecdh.setPrivateKey(d);
      break; // 유효한 스칼라 (n 초과 시 예외 → 재시도)
    } catch { /* rehash */ }
  }
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}
