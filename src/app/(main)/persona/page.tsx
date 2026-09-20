"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Memory = { id: string; kind: string; content: string; confidence: number; source_date: string; last_seen_at: string; evidence?: { note?: string } };
type Activity = { id: string; name: string; created_at: string; props: {
  date?: string; status?: string; saved?: number; reason?: string; supplied?: number; cited?: number;
  signals?: number; citedSignals?: number; memories?: number; corrections?: number;
  signalsAvailable?: boolean; memoriesAvailable?: boolean; interpreted?: number; moments?: number;
} };
type Learning = { memories: Memory[]; diaries: { date: string; edited: boolean }[]; corrections: number; activities?: Activity[]; activityAvailable?: boolean };
export default function PersonaPage() {
  const [data, setData] = useState<Learning | null>(null);
  const [date, setDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await api<Learning>("/api/persona");
    setData(result); setDate(current => current || result.diaries[0]?.date || "");
  }, []);
  useEffect(() => {
    const refresh = () => { if(document.visibilityState === "visible") load().catch(() => setMessage("개인화 정보를 불러오지 못했습니다. 로그인과 연결을 확인해 주세요.")); };
    refresh(); const timer = setInterval(refresh, 30_000); return () => clearInterval(timer);
  }, [load]);
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
      <section className="bg-card border border-line rounded-2xl p-4 space-y-3">
        <h2 className="font-semibold">언제 나를 이해하는 데 쓰이나요?</h2>
        <ol className="list-decimal pl-5 text-sm space-y-2">
          <li>Companion 동기화: 통화 요약·걸음·위치를 서버에 보관합니다. 수집만으로 학습 완료가 되는 것은 아닙니다.</li>
          <li>사진 업로드: 촬영 시각 주변 기록과 기존 기억을 사진 분석에 즉시 제공합니다. 순간 카드의 ‘이 사진을 이해한 근거’에서 선택된 자료를 확인하세요.</li>
          <li>일기 저장·수정: 하루 기록에서 앞으로 참고할 취향·루틴·관계·목표를 추출합니다. 직접 고친 문체는 다음 일기와 회고에 우선 반영합니다.</li>
        </ol>
        <p className="text-xs text-ink-soft">오늘 사진은 먼저 순간 초안으로 분석되고, 하루 확인에서 일기로 완성됩니다. 늦게 동기화된 자료가 기존 일기를 자동으로 덮어쓰지는 않습니다.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">최근 학습·활용 이력</h2>
        <p className="text-xs text-ink-soft">이번 업데이트 이후의 최근 20회입니다. ‘자료 제공’은 AI가 전부 사용했다는 뜻이 아닙니다. 기억 반영 건수에는 기존 기억 갱신도 포함됩니다.</p>
        {data.activityAvailable === false && <p role="status">활용 이력을 조회하지 못했습니다. 새로고침해 주세요.</p>}
        {data.activityAvailable !== false && !data.activities?.length && <p className="text-sm">아직 이력이 없습니다. 사진을 분석하거나 일기를 저장·수정하면 남습니다.</p>}
        {data.activities?.map(a => <article key={a.id} className="bg-card border border-line rounded-xl p-3 text-sm space-y-1">
          <p className="font-semibold">{a.props.date} · {a.name === "context_assembled" ? "사진 맥락 활용" : a.name === "diary_context" ? "일기 작성에 참고" : "장기 기억 갱신"}</p>
          <p className="text-xs text-ink-soft">{new Date(a.created_at).toLocaleString("ko-KR")}</p>
          {a.props.status === "failed" ? <p>{a.props.reason}</p>
            : a.props.status === "running" ? <p>작업 시작됨 · 아직 완료 기록이 없습니다. 오래 지속되면 다시 시도하세요.</p>
            : a.name === "memory_refresh" ? <p>{`기억 ${a.props.saved ?? 0}개 반영${a.props.saved === 0 ? " · 안정적인 새 정보를 찾지 못했거나 근거가 부족했습니다." : ""}`}</p>
            : a.name === "context_assembled" ? <>
              <p>생활 기록 {a.props.supplied ?? 0}개 제공 · AI 근거 선택 {a.props.cited ?? 0}개 · 기존 기억 {a.props.memories ?? 0}개 참고 후보</p>
              {(a.props.signalsAvailable === false || a.props.memoriesAvailable === false) && <p>일부 자료 조회 실패</p>}
              {(a.props.interpreted ?? 0) < (a.props.moments ?? 0) && <p>일부 AI 분석 미완료 · 기본 제목으로 저장</p>}
            </> : <p>생활 기록 {a.props.signals ?? 0}개 제공 · 문장 근거로 표시 {a.props.citedSignals ?? 0}개 · 기억 {a.props.memories ?? 0}개 · 문체 교정 {a.props.corrections ?? 0}개 참고</p>}
        </article>)}
      </section>
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
