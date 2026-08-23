"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

interface Review {
  id: string;
  week_start: string;
  body: string;
  highlights: Array<{ momentId: string; reason: string }>;
  stats: {
    momentCount?: number;
    placeCount?: number;
    places?: string[];
    people?: string[];
    planVsLived?: { 예정: number; 진행: number; 계획에없던사건: number } | null;
  };
  opened_at: string | null;
}

function weekLabel(ws: string): string {
  const d = new Date(`${ws}T00:00:00+09:00`);
  const end = new Date(d.getTime() + 6 * 86400_000);
  const fmt = (x: Date) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(x);
  return `${fmt(d)} ~ ${fmt(end)}`;
}

// 주간 회고 (FR-7)
export default function WeeklyPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api<{ reviews: Review[] }>("/api/reviews").then((r) => {
      setReviews(r.reviews);
      if (r.reviews[0]) setOpenId(r.reviews[0].id);
    }).catch(() => setReviews([]));
  }, []);

  function open(r: Review) {
    setOpenId(openId === r.id ? null : r.id);
    if (!r.opened_at) {
      api("/api/reviews", { method: "POST", body: JSON.stringify({ weekStart: r.week_start }) }).catch(() => {});
    }
  }

  return (
    <main className="px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold">주간 회고</h1>
        <p className="text-sm text-ink-soft">매주 일요일 저녁, 한 주가 이야기로 정리돼요</p>
      </header>

      {reviews === null && (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="h-24 rounded-2xl bg-card border border-line pulse-soft" />)}
        </div>
      )}

      {reviews?.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🗓️</p>
          <p className="font-semibold">아직 회고가 없어요</p>
          <p className="text-sm text-ink-soft mt-1">한 주에 3개 이상의 순간이 쌓이면<br />일요일 저녁 자동으로 만들어 드려요</p>
          <Link href="/upload" className="inline-block mt-5 text-accent text-sm font-semibold">오늘 기록 시작하기 →</Link>
        </div>
      )}

      <div className="space-y-3">
        {reviews?.map((r) => (
          <div key={r.id} className="bg-card border border-line rounded-2xl overflow-hidden fade-up">
            <button onClick={() => open(r)} className="w-full flex items-center justify-between p-4">
              <div className="text-left">
                <p className="font-bold">{weekLabel(r.week_start)}</p>
                <p className="text-xs text-ink-soft mt-0.5">
                  순간 {r.stats.momentCount ?? 0}개 · 장소 {r.stats.placeCount ?? 0}곳
                  {(r.stats.people?.length ?? 0) > 0 && ` · ${r.stats.people!.slice(0, 3).join(", ")}`}
                </p>
              </div>
              <span className="text-ink-soft">{openId === r.id ? "▲" : "▼"}</span>
            </button>
            {openId === r.id && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{r.body}</p>
                {r.stats.planVsLived && (
                  <div className="bg-paper rounded-xl p-3 text-sm">
                    <p className="font-semibold text-xs text-ink-soft mb-1">Plan vs Lived</p>
                    예정 {r.stats.planVsLived.예정}건 중 {r.stats.planVsLived.진행}건 진행,
                    계획에 없던 사건 {r.stats.planVsLived.계획에없던사건}건
                  </div>
                )}
                {(r.stats.places?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.stats.places!.map((p) => (
                      <span key={p} className="text-[11px] bg-accent-soft rounded-full px-2 py-0.5">📍 {p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 text-center">
        <Link href="/people" className="text-sm text-accent font-semibold">함께한 사람들 보기 →</Link>
      </div>
    </main>
  );
}
