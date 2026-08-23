"use client";

import { useEffect, useRef } from "react";
import type { Moment } from "@/lib/types";

declare global {
  interface Window {
    kakao?: {
      maps: {
        load: (cb: () => void) => void;
        LatLng: new (lat: number, lng: number) => unknown;
        Map: new (el: HTMLElement, opts: unknown) => { setBounds: (b: unknown) => void };
        LatLngBounds: new () => { extend: (p: unknown) => void };
        Marker: new (opts: unknown) => { setMap: (m: unknown) => void };
        Polyline: new (opts: unknown) => { setMap: (m: unknown) => void };
        CustomOverlay: new (opts: unknown) => { setMap: (m: unknown) => void };
      };
    };
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao?.maps) return window.kakao.maps.load(resolve);
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY}&autoload=false`;
    script.onload = () => window.kakao!.maps.load(resolve);
    script.onerror = () => reject(new Error("kakao sdk load failed"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** 데일리 지도 (FR-6.1): Moment 핀 + 시간순 연결선 */
export default function KakaoMap({ moments, className }: { moments: Moment[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const located = moments.filter((m) => m.lat != null && m.lng != null);

  useEffect(() => {
    if (!ref.current || located.length === 0) return;
    let cancelled = false;
    loadSdk().then(() => {
      if (cancelled || !ref.current || !window.kakao) return;
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(located[0].lat!, located[0].lng!);
      const map = new kakao.maps.Map(ref.current, { center, level: 6 });
      const bounds = new kakao.maps.LatLngBounds();
      const path: unknown[] = [];

      located.forEach((m, i) => {
        const pos = new kakao.maps.LatLng(m.lat!, m.lng!);
        bounds.extend(pos);
        path.push(pos);
        const overlay = new kakao.maps.CustomOverlay({
          position: pos,
          yAnchor: 1.2,
          content: `<div style="background:#c2703d;color:#fff;border-radius:999px;min-width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);padding:0 4px">${i + 1}</div>`,
        });
        overlay.setMap(map);
      });

      if (path.length > 1) {
        new kakao.maps.Polyline({
          path, strokeWeight: 2.5, strokeColor: "#c2703d", strokeOpacity: 0.55, strokeStyle: "shortdash",
        }).setMap(map);
      }
      map.setBounds(bounds);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(located.map((m) => [m.lat, m.lng]))]);

  if (located.length === 0) {
    // 지도 폴백: 타임라인 안내 (FR-6.1 AC)
    return (
      <div className={`flex items-center justify-center bg-card border border-line rounded-2xl text-ink-soft text-sm ${className ?? "h-40"}`}>
        위치 정보가 있는 사진이 없어 타임라인으로 표시해요
      </div>
    );
  }
  return <div ref={ref} className={`rounded-2xl overflow-hidden border border-line ${className ?? "h-56"}`} />;
}
