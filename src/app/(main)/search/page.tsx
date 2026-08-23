"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

interface SearchResult {
  id: string;
  date: string;
  title: string | null;
  place_name: string | null;
  address: string | null;
  people: Array<{ name: string }>;
  mood: string | null;
  thumbUrl: string | null;
  score: number;
}

// 기억 검색 (FR-8): 자연어 → 하이브리드 검색, 무료 30일 경계 + 잠금 카드
export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!q.trim() || loading) return;
    setLoading(true);
    try {
      const res = await api<{ results: SearchResult[]; lockedCount: number }>(
        `/api/search?q=${encodeURIComponent(q.trim())}`);
      setResults(res.results);
      setLockedCount(res.lockedCount);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }

  return (
    <main className="px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold">기억 검색</h1>
        <p className="text-sm text-ink-soft">&ldquo;지난달 아버지와 간 식당&rdquo;처럼 물어보세요</p>
      </header>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="언제, 어디서, 누구와…"
          className="flex-1 bg-card border border-line rounded-full px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button onClick={search} disabled={loading}
          className="bg-accent text-white rounded-full px-5 font-semibold text-sm disabled:opacity-50">
          {loading ? "…" : "검색"}
        </button>
      </div>

      {loading && (
        <div className="space-y-2.5 mt-5">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-card border border-line pulse-soft" />)}
        </div>
      )}

      {!loading && results !== null && (
        <div className="mt-5 space-y-2.5">
          {results.length === 0 && (
            <p className="text-center text-sm text-ink-soft py-10">최근 30일 기록에서 찾지 못했어요</p>
          )}
          {results.map((r) => (
            <Link key={r.id} href={`/?date=${r.date}`}
              className="flex gap-3 bg-card border border-line rounded-2xl p-3 fade-up">
              {r.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.thumbUrl} alt="" className="w-16 h-16 object-cover rounded-xl shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-accent-soft flex items-center justify-center text-xl shrink-0">📷</div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-ink-soft">{r.date} {r.mood ?? ""}</p>
                <p className="font-semibold text-sm truncate">{r.title ?? "기록"}</p>
                <p className="text-xs text-ink-soft truncate">
                  {r.place_name ?? r.address ?? ""}
                  {r.people?.length > 0 && ` · ${r.people.map((p) => p.name).join(", ")}`}
                </p>
              </div>
            </Link>
          ))}

          {/* 잠금 카드 (§10 — 전환 넛지) */}
          {lockedCount > 0 && (
            <div className="bg-card border border-dashed border-accent/50 rounded-2xl p-4 text-center">
              <p className="text-2xl mb-1">🔒</p>
              <p className="text-sm font-semibold">30일 이전 기록 {lockedCount}개가 보관 중이에요</p>
              <p className="text-xs text-ink-soft mt-1">내 삶 전체의 기억 검색은 프리미엄에서 — 출시 준비 중</p>
            </div>
          )}
        </div>
      )}

      {results === null && !loading && (
        <div className="mt-8 space-y-2">
          <p className="text-xs text-ink-soft px-1">이렇게 검색해 보세요</p>
          {["지난주 점심 먹은 곳", "성수동에서 만난 사람", "비 오던 날의 기록"].map((ex) => (
            <button key={ex} onClick={() => { setQ(ex); }}
              className="block w-full text-left bg-card border border-line rounded-xl px-4 py-2.5 text-sm text-ink-soft">
              {ex}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
