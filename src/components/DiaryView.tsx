"use client";

import { useEffect, useState } from "react";
import type { DiaryEntry } from "@/lib/types";
import { api } from "@/lib/client";

/** 일기 렌더링 — 문장별 근거 배지 + 탭 수정 (FR-5.3, 페르소나 2층 학습 입구) */
export default function DiaryView({ diary, date, editable = true, onUpdated, onChanged }: {
  diary: DiaryEntry;
  date: string;
  editable?: boolean;
  onUpdated?: (d: { sentences: DiaryEntry["sentences"] }) => void;
  /** 다시 쓰기/삭제 후 부모가 데이터를 다시 불러오도록 */
  onChanged?: () => void | Promise<void>;
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"rewrite" | "delete" | null>(null);
  const [sentences, setSentences] = useState(diary.sentences ?? []);

  // 부모가 새 일기를 내려주면 로컬 문장 상태 동기화
  useEffect(() => { setSentences(diary.sentences ?? []); }, [diary]);

  async function rewrite() {
    if (action || !confirm("일기를 처음부터 다시 쓸까요? 문장 수정 내역은 사라져요.")) return;
    setAction("rewrite");
    try {
      await api(`/api/days/${date}/confirm`, { method: "POST", body: JSON.stringify({}) });
      await onChanged?.();
    } catch (e) {
      alert(`일기 생성에 실패했어요. 잠시 후 다시 시도해 주세요.\n${e instanceof Error ? e.message : ""}`);
    }
    setAction(null);
  }

  async function removeDiary() {
    if (action || !confirm("이 날의 일기를 삭제할까요? 순간 기록은 남아요.")) return;
    setAction("delete");
    try {
      await api(`/api/diary/${date}`, { method: "DELETE" });
      await onChanged?.();
    } catch { /* 유지 */ }
    setAction(null);
  }

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
        <div className="mb-3 pb-2.5 border-b border-line">
          <p className="text-[10px] font-semibold text-ink-soft tracking-widest mb-0.5">오늘의 한 줄</p>
          <p className="text-[15px] font-bold text-accent leading-snug">“{diary.one_line}”</p>
        </div>
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
      {editable && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-line">
          <button onClick={rewrite} disabled={!!action}
            className="flex-1 text-sm font-semibold bg-accent-soft text-accent rounded-full py-2 disabled:opacity-50">
            {action === "rewrite" ? <span className="pulse-soft">다시 쓰는 중…</span> : "🔄 일기 다시 쓰기"}
          </button>
          <button onClick={removeDiary} disabled={!!action}
            className="px-4 text-sm text-red-500 disabled:opacity-50">
            {action === "delete" ? "삭제 중…" : "삭제"}
          </button>
        </div>
      )}
    </div>
  );
}
