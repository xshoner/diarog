"use client";

import { useEffect } from "react";

/** 서비스워커 등록 (푸시 + PWA) */
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
