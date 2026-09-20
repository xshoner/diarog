"use client";

import { useState } from "react";
import Link from "next/link";
import type { Moment } from "@/lib/types";
import { api } from "@/lib/client";

type Details = {
  signals: { id: string; source: string; title: string; summary: string; occurred_at: string }[];
  memories: { id: string; kind: string; content: string; source_date: string }[];
};
const names: Record<string, string> = { audio: "통화 요약", location: "위치", steps: "걸음 수" };
export default function ContextEvidence({ moment }: { moment: Moment }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const audit = moment.ai?.context;
  if(!audit) return null;
  async function load() {
    if(busy) return;
    setBusy(true); setError("");
    try { setDetails(await api<Details>(`/api/context?momentId=${moment.id}`)); }
    catch { setError("자료를 불러오지 못했습니다. 다시 열어 주세요."); }
    finally { setBusy(false); }
  }
  return <details className="border-t border-line px-3 py-2 text-xs" onClick={e => e.stopPropagation()} onToggle={e => { if(e.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer text-accent">이 사진을 이해한 근거 · 생활 기록 {audit.suppliedSignalIds.length}개 · 기억 {audit.suppliedMemoryIds.length}개</summary>
    <div className="space-y-2 pt-2">
      <p>분석 시각: {new Date(audit.assembledAt).toLocaleString("ko-KR")}</p>
      <p>{audit.interpreted ? `AI가 근거로 선택한 생활 기록 ${audit.citedSignalIds.length}개 · 기억 ${audit.citedMemoryIds.length}개` : "AI 분석 실패/사용량 제한 · 기본 제목으로 저장됨. 자료가 실제 해석에 반영됐다고 확인할 수 없습니다."}</p>
      <p className="text-ink-soft">자료 제공과 AI의 근거 선택을 구분합니다. 시간 근접은 같은 사건이라는 증거가 아니며, 통화는 인식 오류 가능성, 걸음 수는 하루 합계입니다.</p>
      {(!audit.signalsAvailable || !audit.memoriesAvailable) && <p className="text-warn">분석 당시 일부 자료를 조회하지 못했습니다. 사진 추가 화면에서 다시 반영할 수 있습니다.</p>}
      {audit.truncated && <p>그날 기록이 많아 최근 1,000개 안에서 참고 자료를 골랐습니다.</p>}
      {busy && <p>참고 자료를 확인하는 중…</p>}
      {error && <p role="status">{error}</p>}
      {details?.signals.map(s => <div key={s.id} className="rounded-lg bg-paper p-2">
        <p className="font-semibold">{names[s.source] ?? s.source} · {audit.citedSignalIds.includes(s.id) ? "AI 근거 선택" : "참고 후보"}</p>
        <p>{s.title} · {new Date(s.occurred_at).toLocaleString("ko-KR")}</p>
        <p className="whitespace-pre-wrap">{s.summary}</p>
      </div>)}
      {details?.memories.map(m => <div key={m.id} className="rounded-lg bg-paper p-2">
        <p>{audit.citedMemoryIds.includes(m.id) ? "AI 근거 선택" : "참고 후보"} · 기억 · {m.source_date}</p><p>{m.content}</p>
      </div>)}
      {details && details.signals.length < audit.suppliedSignalIds.length && <p>일부 원본 기록은 삭제되어 표시하지 않습니다.</p>}
      <p>아직 휴대폰에만 있는 기록은 반영되지 않습니다. 동기화 후 사진 추가 화면에서 다시 반영하세요. 확정한 기록·일기는 자동으로 바뀌지 않습니다.</p>
      <Link href="/persona" className="underline mr-3">무엇을 기억했는지 확인</Link><Link href="/companion" className="underline">수집 기록 확인</Link>
    </div>
  </details>;
}
