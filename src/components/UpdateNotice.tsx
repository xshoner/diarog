"use client";

import { useEffect, useState } from "react";

// 스테일 번들 감지: 탭이 다시 보일 때마다 서버 배포 SHA와 내 빌드 SHA를 비교.
// 다르면 새로고침 배너 표시 — "배포했는데 폰에서 그대로"를 근본 차단.
const MY_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";

export default function UpdateNotice() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (MY_SHA === "dev") return; // 로컬 개발은 제외
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { sha } = await res.json();
        if (!cancelled && sha && sha !== "dev" && sha !== MY_SHA) setStale(true);
      } catch { /* 오프라인 등 — 무시 */ }
    }
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg">
      <button onClick={() => location.reload()}
        className="w-full bg-ink text-paper rounded-full py-2.5 text-sm font-semibold shadow-xl active:scale-[0.99]">
        ✨ 새 버전이 나왔어요 — 탭해서 새로고침
      </button>
    </div>
  );
}
