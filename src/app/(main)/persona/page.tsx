"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Memory = { id: string; kind: string; content: string; confidence: number; source_date: string; last_seen_at: string; evidence?: { note?: string } };
type Learning = { memories: Memory[]; diaries: { date: string; edited: boolean }[]; corrections: number };
export default function PersonaPage() {
  const [data, setData] = useState<Learning | null>(null);
  const [date, setDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await api<Learning>("/api/persona");
    setData(result); setDate(current => current || result.diaries[0]?.date || "");
  }, []);
  useEffect(() => { load().catch(() => setMessage("개인화 정보를 불러오지 못했습니다. 로그인과 연결을 확인해 주세요.")); }, [load]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await load(); }
    catch(e) { setMessage(e instanceof Error ? e.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="px-5 py-6 space-y-6">
    <Link href="/settings" className="text-sm text-ink-soft">← 설정</Link>
    <h1 className="text-xl font-bold">나에게 맞춰지는 페르소나</h1>
    <p className="text-sm text-ink-soft">일기를 저장하면 관심사와 생활 맥락을 기억하고, 직접 고친 문장은 다음 일기와 주간 회고의 문체에 반영합니다. 최근 교정을 우선하며, AI가 쓴 글만으로 내 말투를 단정하지 않습니다.</p>
    {data && <>
      <section className="bg-card border border-line rounded-2xl p-4 space-y-2">
        <h2 className="font-semibold">개인화 근거</h2>
        <p className="text-sm">문체 교정 {data.corrections}개 · 직접 수정한 일기 {data.diaries.filter(d => d.edited).length}개 (최근 100일기 기준)</p>
        <p className="text-sm">저장된 기억 {data.memories.length}개 표시 · 다음 생성에는 최근 신뢰도 70% 이상 기억 최대 12개를 참고합니다.</p>
        <p className="text-xs text-ink-soft">선택한 기본 페르소나에 최근 20개 교정과 이전 14개 일기를 함께 참고합니다. 모델 자체의 재훈련이 아니라 내 기록을 바탕으로 한 개인화입니다.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">이전 일기도 기억에 반영하기</h2>
        <p className="text-sm text-ink-soft">저장·수정 때 기억 갱신이 실패했다면 여기에서 다시 시도하세요. AI 사용량에 포함됩니다.</p>
        <select aria-label="학습할 일기 날짜" value={date} onChange={e => setDate(e.target.value)} className="border border-line rounded-lg p-2">
          {data.diaries.map(d => <option key={d.date} value={d.date}>{d.date}{d.edited ? " · 직접 수정" : ""}</option>)}
        </select>
        <button disabled={busy || !date} className="ml-3" onClick={() => run(async () => {
          await api("/api/persona", { method: "POST", body: JSON.stringify({ date }) }); setMessage("기억 갱신이 완료되었습니다.");
        })}>이 일기 반영</button>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">내가 확인하고 고르는 기억</h2>
        <p className="text-xs text-ink-soft">틀렸거나 더 이상 맞지 않는 기억을 삭제하면 다음 생성부터 제외됩니다. 같은 원본 일기를 다시 반영하면 재추출될 수 있습니다.</p>
        {!data.memories.length && <p className="text-sm">아직 저장된 기억이 없습니다.</p>}
        {data.memories.map(m => <article key={m.id} className="bg-card border border-line rounded-xl p-4 space-y-2">
          <p className="text-sm">{m.content}</p>
          <p className="text-xs text-ink-soft">근거 일기 {m.source_date} · 추출 신뢰도 {Math.round(Number(m.confidence) * 100)}%</p>
          {m.evidence?.note && <p className="text-xs text-ink-soft">{m.evidence.note}</p>}
          <button disabled={busy} className="text-sm" onClick={() => run(async () => {
            await api("/api/persona", { method: "DELETE", body: JSON.stringify({ id: m.id }) }); setMessage("기억을 삭제했습니다.");
          })}>이 기억 삭제</button>
        </article>)}
      </section>
    </>}
    <button disabled={busy} onClick={() => run(async () => {})}>새로고침</button>
    <p role="status" className="text-sm">{busy ? "처리 중…" : message}</p>
  </div>;
}
