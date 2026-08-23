"use client";

import { useState } from "react";
import type { DiaryEntry } from "@/lib/types";
import { api } from "@/lib/client";

/** 일기 렌더링 — 문장별 근거 배지 + 탭 수정 (FR-5.3, 페르소나 2층 학습 입구) */
export default function DiaryView({ diary, date, editable = true, onUpdated }: {
  diary: DiaryEntry;
  date: string;
  editable?: boolean;
  onUpdated?: (d: { sentences: DiaryEntry["sentences"] }) => void;
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentences, setSentences] = useState(diary.sentences ?? []);

  async function save(idx: number) {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api<{ sentences: DiaryEntry["sentences"] }>(`/api/diary/${date}`, {
        method: "PATCH",
        body: JSON.stringify({ sentIdx: idx, revised: draft }),
      });
      setSentences(res.sentences);
      onUpdated?.(res);
      setEditIdx(null);
    } catch { /* 유지 */ }
    setBusy(false);
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-4">
      {diary.one_line && (
        <p className="text-sm font-semibold text-accent mb-2.5">“{diary.one_line}”</p>
      )}
      <div className="space-y-1 leading-relaxed text-[15px]">
        {sentences.map((s, i) =>
          editIdx === i ? (
            <div key={i} className="my-1.5">
              <textarea
                className="w-full bg-paper border border-accent rounded-xl p-2 text-[15px] outline-none"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button onClick={() => save(i)} disabled={busy}
                  className="text-xs bg-accent text-white rounded-full px-3 py-1 disabled:opacity-50">
                  {busy ? "저장 중…" : "저장"}
                </button>
                <button onClick={() => setEditIdx(null)} className="text-xs text-ink-soft px-2">취소</button>
              </div>
            </div>
          ) : (
            <span
              key={i}
              onClick={() => { if (editable) { setEditIdx(i); setDraft(s.text); } }}
              className={`${editable ? "cursor-pointer active:bg-accent-soft rounded" : ""} ${
                s.kind === "inference" ? "uncertain" : ""
              }`}
              title={s.kind === "inference" ? "추정이 섞인 문장이에요 (탭해서 수정)" : editable ? "탭해서 수정" : undefined}
            >
              {s.text}{" "}
            </span>
          )
        )}
      </div>
      <p className="text-[11px] text-ink-soft mt-3">
        점선 문장은 <span className="uncertain">추정</span>이에요 · 문장을 탭하면 고칠 수 있고, AI가 당신의 문체를 배워요
      </p>
    </div>
  );
}
