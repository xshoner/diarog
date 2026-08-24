"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import type { DayBundle } from "@/lib/types";
import KakaoMap from "@/components/KakaoMap";
import MomentCard from "@/components/MomentCard";
import DiaryView from "@/components/DiaryView";

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shift(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(d);
}

function HomeInner() {
  const params = useSearchParams();
  const initial = params.get("date");
  const [date, setDate] = useState(
    initial && /^\d{4}-\d{2}-\d{2}$/.test(initial) ? initial : todayKst());
  const [bundle, setBundle] = useState<DayBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const isToday = date === todayKst();

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      setBundle(await api<DayBundle>(`/api/days/${d}`));
    } catch {
      setBundle(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const moments = bundle?.moments ?? [];
  const drafts = moments.filter((m) => m.status === "draft");

  return (
    <main className="px-4 pt-4">
      {/* 날짜 네비게이션 (FR-6.2) */}
      <header className="flex items-center justify-between mb-3">
        <button onClick={() => setDate(shift(date, -1))} aria-label="이전 날"
          className="w-9 h-9 rounded-full bg-card border border-line text-ink-soft active:scale-95">←</button>
        <div className="text-center">
          <h1 className="font-bold text-lg">{dateLabel(date)}</h1>
          {!isToday && (
            <button onClick={() => setDate(todayKst())} className="text-[11px] text-accent">오늘로</button>
          )}
        </div>
        <button onClick={() => setDate(shift(date, 1))} disabled={isToday} aria-label="다음 날"
          className="w-9 h-9 rounded-full bg-card border border-line text-ink-soft active:scale-95 disabled:opacity-30">→</button>
      </header>

      {loading ? (
        <div className="space-y-3">
          <div className="h-56 rounded-2xl bg-card border border-line pulse-soft" />
          <div className="h-24 rounded-2xl bg-card border border-line pulse-soft" />
        </div>
      ) : moments.length === 0 ? (
        <div className="text-center py-16 fade-up">
          <p className="text-4xl mb-3">🌿</p>
          <p className="font-semibold">아직 기록이 없어요</p>
          <p className="text-sm text-ink-soft mt-1 mb-6">
            사진을 추가하면 AI가 하루를 자동으로 조립해요
          </p>
          <Link href="/upload" className="inline-block bg-accent text-white rounded-full px-6 py-2.5 text-sm font-semibold shadow-lg shadow-accent/25">
            사진 추가하기
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <KakaoMap moments={moments} className="h-56" />

          {drafts.length > 0 && (
            <Link href={`/ritual/${date}`}
              className="block bg-accent text-white rounded-2xl p-4 text-center font-semibold shadow-lg shadow-accent/25 active:scale-[0.99] transition-transform">
              {bundle?.diary
                ? `✨ 새로운 순간 ${drafts.length}개 — 일기에 반영하기`
                : `✨ ${drafts.length}개의 순간이 확인을 기다려요 — 30초 확정하기`}
            </Link>
          )}

          {bundle?.diary && <DiaryView diary={bundle.diary} date={date} onChanged={() => load(date)} />}

          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-ink-soft">
                오늘의 순간 {moments.length}개
              </h2>
              <Link href={`/ritual/${date}`} className="text-xs text-accent font-semibold">
                수정·삭제 ›
              </Link>
            </div>
            {moments.map((m, i) => (
              <MomentCard key={m.id} moment={m} photos={bundle!.photos} evidence={bundle!.evidence} index={i} />
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
