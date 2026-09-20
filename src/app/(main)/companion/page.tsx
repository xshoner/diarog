"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Device = { id: string; name: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null };
type Signal = { id: string; source: string; title: string; summary: string; occurred_at: string };

export default function CompanionPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [token, setToken] = useState("");
  const [name, setName] = useState("내 Android");
  const [date, setDate] = useState(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [live, setLive] = useState(false);
  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      api<{ devices: Device[] }>("/api/companion/devices"), api<{ signals: Signal[] }>("/api/signals"),
    ]);
    setDevices(d.devices); setSignals(s.signals); setLive(true); setNow(Date.now());
  }, []);
  useEffect(() => {
    const refresh = () => { setNow(Date.now()); if(document.visibilityState === "visible") load().catch(() => { setLive(false); setMessage("서버 상태를 갱신하지 못했습니다. 마지막 조회 결과입니다."); }); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  return <div className="px-5 py-6 space-y-6">
    <Link href="/settings" className="text-sm text-ink-soft">← 설정</Link>
    <h1 className="text-xl font-bold">Android Companion</h1>
    <p className="text-sm text-ink-soft">통화 녹음의 요약, 걸음 수, 이동 기록을 일기에 연결하세요. 음성은 휴대폰에서 글로 변환하며, 전사문은 서버와 AI 요약 서비스에 전달됩니다. diarog에는 요약과 추출 항목만 저장합니다.</p>
    <section className="bg-card border border-line rounded-2xl p-4 space-y-3">
      <h2 className="font-semibold">휴대폰 연결</h2>
      <label className="block text-sm">기기 이름<input className="block border border-line rounded-lg p-2 w-full" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="bg-accent text-white rounded-xl px-4 py-2" disabled={busy || !name.trim()} onClick={() => run(async () => {
        const result = await api<{ token: string }>("/api/companion/devices", { method: "POST", body: JSON.stringify({ name }) }); setToken(result.token);
      })}>연결 토큰 발급</button>
      {token && <div className="space-y-2">
        <p className="text-sm">앱에 붙여넣으세요. 토큰은 지금 한 번만 표시되며 90일 후 만료됩니다.</p>
        <input aria-label="연결 토큰" className="w-full border border-line rounded-lg p-2 font-mono text-xs" readOnly value={token} onFocus={(e) => e.target.select()} />
        <button onClick={() => navigator.clipboard.writeText(token).then(() => setMessage("토큰을 복사했어요.")).catch(() => setMessage("토큰을 길게 눌러 복사해 주세요."))}>복사</button>
        <button className="ml-4" onClick={() => setToken("")}>숨기기</button>
      </div>}
      <p className="text-xs text-ink-soft">앱에서 서버 주소와 토큰을 저장한 뒤 필요한 수집 기능만 켜세요. 연결 해제는 이후 업로드를 차단합니다.</p>
      {devices.map((d) => <div key={d.id} className="border-t border-line pt-3 text-sm">
        <strong>{d.name}</strong>
        <p className="text-sm">{live && !d.revoked_at && Date.parse(d.expires_at) > now && d.last_seen_at && now - Date.parse(d.last_seen_at) >= 0 && now - Date.parse(d.last_seen_at) < 90_000
          ? <><span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-blue-500 motion-safe:animate-pulse mr-2" />최근 90초 내 서버 응답 확인</>
          : d.revoked_at ? "연결 해제됨" : Date.parse(d.expires_at) <= now ? "토큰 만료" : "현재 연결 미확인"}</p>
        <p className="text-xs text-ink-soft">만료: {new Date(d.expires_at).toLocaleDateString()} · 마지막 연결: {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "아직 없음"}</p>
        {!d.revoked_at && <button disabled={busy} onClick={() => run(async () => { await api("/api/companion/devices", { method: "DELETE", body: JSON.stringify({ id: d.id }) }); setToken(""); })}>연결 해제</button>}
      </div>)}
    </section>
    <section className="space-y-3">
      <h2 className="font-semibold">수집한 기록으로 일기 쓰기</h2>
      <p className="text-xs text-ink-soft">날짜는 한국 시간 기준입니다. 수집만으로 기존 일기를 덮어쓰지 않습니다.</p>
      <input type="date" aria-label="일기 날짜" value={date} onChange={(e) => setDate(e.target.value)} className="border border-line rounded-lg p-2" />
      <button disabled={busy || !date} className="ml-3" onClick={() => {
        if (confirm(`${date} 일기를 생성할까요? 기존 일기와 직접 수정한 내용이 있으면 새 내용으로 바뀝니다.`)) void run(async () => {
          const result = await api<{ learning?: { memoryUpdated: boolean } }>(`/api/days/${date}/confirm`, { method: "POST", body: "{}" });
          setMessage(result.learning?.memoryUpdated === false ? "일기는 저장됐지만 기억 갱신에 실패했습니다. 설정 → 개인화 근거와 기억에서 재시도하세요." : "일기를 만들었어요. 해당 날짜 기록에서 확인할 수 있어요.");
        });
      }}>일기 생성</button>
    </section>
    <p role="status" className="text-sm">{busy ? "처리 중…" : message}</p>
    <section className="space-y-3">
      <h2 className="font-semibold">최근 수집 기록</h2>
      <button disabled={busy} onClick={() => run(async () => {})}>새로고침</button>
      <p className="text-xs text-ink-soft">최대 500개. 통화 요약에는 인식 오류가 있을 수 있어요. 삭제해도 이미 생성한 일기·장기기억에는 남을 수 있습니다.</p>
      {signals.length === 0 && <p className="text-sm text-ink-soft">아직 수집한 기록이 없습니다.</p>}
      {signals.map((s) => <article key={s.id} className="bg-card border border-line rounded-xl p-4 space-y-2">
        <p className="text-xs text-ink-soft">{s.source} · {new Date(s.occurred_at).toLocaleString()}</p>
        <h3 className="font-semibold">{s.title}</h3><p className="text-sm whitespace-pre-wrap">{s.summary}</p>
        {s.source === "audio" && <p className="text-xs text-ink-soft">기기 내 STT · 내용과 발생 시각 확인 필요</p>}
        <button disabled={busy} className="text-xs" onClick={() => {
          if (confirm("이 수집 기록을 삭제할까요?")) void run(async () => { await api("/api/signals", { method: "DELETE", body: JSON.stringify({ id: s.id }) }); });
        }}>기록 삭제</button>
      </article>)}
    </section>
  </div>;
}
