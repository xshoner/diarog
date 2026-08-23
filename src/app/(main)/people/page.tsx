"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Person {
  name: string;
  count: number;
  lastDate: string;
  lastTitle: string | null;
  places: string[];
}

// 만남 기록 (FR-9.1) — 캘린더 참석자 + 사용자 태그 기반 (얼굴 인식 아님)
export default function PeoplePage() {
  const [people, setPeople] = useState<Person[] | null>(null);

  useEffect(() => {
    api<{ people: Person[] }>("/api/people").then((r) => setPeople(r.people)).catch(() => setPeople([]));
  }, []);

  return (
    <main className="px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold">함께한 사람들</h1>
        <p className="text-sm text-ink-soft">캘린더 참석자와 내가 태그한 사람 기준이에요</p>
      </header>

      {people === null && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-card border border-line pulse-soft" />)}
        </div>
      )}

      {people?.length === 0 && (
        <div className="text-center py-16 text-ink-soft text-sm">
          <p className="text-4xl mb-3">👥</p>
          아직 만남 기록이 없어요.<br />캘린더를 연동하거나 순간에 사람을 태그해 보세요.
        </div>
      )}

      <div className="space-y-2.5">
        {people?.map((p) => (
          <div key={p.name} className="bg-card border border-line rounded-2xl p-4 fade-up">
            <div className="flex items-center justify-between">
              <p className="font-bold">{p.name}</p>
              <span className="text-xs text-ink-soft">{p.count}번의 만남</span>
            </div>
            <p className="text-xs text-ink-soft mt-1">
              최근: {p.lastDate} {p.lastTitle ? `· ${p.lastTitle}` : ""}
            </p>
            {p.places.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {p.places.map((pl) => (
                  <span key={pl} className="text-[11px] bg-accent-soft rounded-full px-2 py-0.5">📍 {pl}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
