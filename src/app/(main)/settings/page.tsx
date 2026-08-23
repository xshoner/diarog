"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, subscribePush } from "@/lib/client";
import type { Me } from "@/lib/types";

const PERSONA_NAMES: Record<string, string> = {
  plain: "📝 담백한 기록가", essay: "🌙 감성 에세이스트", humor: "😎 유머러스한 친구", dry: "🔍 건조한 관찰자",
};

// 설정·프라이버시 센터 (F10)
export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(() => router.push("/onboarding"));
  }, [router]);

  async function setPersona(persona: string) {
    setBusy("persona");
    await api("/api/me", { method: "PATCH", body: JSON.stringify({ persona }) }).catch(() => {});
    setMe((m) => (m ? { ...m, persona } : m));
    setBusy(null);
  }

  async function setRitualTime(ritualTime: string) {
    await api("/api/me", { method: "PATCH", body: JSON.stringify({ ritualTime }) }).catch(() => {});
    setMe((m) => (m ? { ...m, ritualTime } : m));
  }

  async function togglePush() {
    setBusy("push");
    try {
      if (me?.pushEnabled) {
        await api("/api/push/subscribe", { method: "DELETE" });
        setMe((m) => (m ? { ...m, pushEnabled: false } : m));
      } else {
        const ok = await subscribePush(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!);
        if (ok) setMe((m) => (m ? { ...m, pushEnabled: true } : m));
        else alert("알림 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요.\niPhone은 홈 화면에 추가한 뒤에 켤 수 있어요.");
      }
    } catch { }
    setBusy(null);
  }

  async function disconnectCalendar() {
    if (!confirm("캘린더 연동을 해제할까요? 캐시된 일정이 즉시 삭제돼요.")) return;
    setBusy("calendar");
    await api("/api/calendar/disconnect", { method: "POST" }).catch(() => {});
    setMe((m) => (m ? { ...m, calendarConnected: false } : m));
    setBusy(null);
  }

  async function exportAll() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", { method: "POST" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `diarog-export.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("내보내기에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
    setExporting(false);
  }

  async function deleteAccount() {
    if (!confirm("정말 계정을 삭제할까요? 모든 기록·사진·일기가 삭제되며 30일 내 완전 파기됩니다.")) return;
    if (!confirm("삭제 전에 '전체 내보내기'로 백업하는 것을 권장해요. 그래도 삭제할까요?")) return;
    await api("/api/account/delete", { method: "POST" }).catch(() => {});
    router.push("/onboarding");
  }

  if (!me) return <main className="px-4 pt-6"><div className="h-40 rounded-2xl bg-card border border-line pulse-soft" /></main>;

  return (
    <main className="px-4 pt-5 space-y-5">
      <header className="flex items-center gap-3">
        {me.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.avatar} alt="" className="w-12 h-12 rounded-full" />
        ) : <div className="w-12 h-12 rounded-full bg-accent-soft flex items-center justify-center text-xl">🙂</div>}
        <div>
          <h1 className="font-bold">{me.name}</h1>
          <p className="text-xs text-ink-soft">{me.email} · {me.plan === "free" ? "무료 플랜" : me.plan}</p>
        </div>
      </header>

      <section className="bg-card border border-line rounded-2xl divide-y divide-line">
        <div className="p-4">
          <p className="text-sm font-semibold mb-2">나의 페르소나</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(PERSONA_NAMES).map(([key, name]) => (
              <button key={key} onClick={() => setPersona(key)} disabled={busy === "persona"}
                className={`text-[13px] rounded-xl px-3 py-2.5 border transition-all ${
                  me.persona === key ? "border-accent bg-accent-soft font-semibold" : "border-line"
                }`}>
                {name}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft mt-2">일기를 고칠 때마다 AI가 당신의 문체를 배워요</p>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">확인 알림 시각</p>
            <p className="text-[11px] text-ink-soft">기본 21:00 (KST)</p>
          </div>
          <input type="time" value={me.ritualTime?.slice(0, 5) ?? "21:00"}
            onChange={(e) => setRitualTime(e.target.value)}
            className="bg-paper border border-line rounded-xl px-3 py-1.5 text-sm" />
        </div>

        <div className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">푸시 알림</p>
            <p className="text-[11px] text-ink-soft">{me.pushEnabled ? "켜짐" : "꺼짐"}</p>
          </div>
          <button onClick={togglePush} disabled={busy === "push"}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              me.pushEnabled ? "bg-line text-ink" : "bg-accent text-white"
            }`}>
            {me.pushEnabled ? "끄기" : "켜기"}
          </button>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Google 캘린더</p>
            <p className="text-[11px] text-ink-soft">
              {me.calendarConnected ? "연결됨 (읽기 전용)" : "연결 안 됨"}
            </p>
          </div>
          {me.calendarConnected ? (
            <button onClick={disconnectCalendar} disabled={busy === "calendar"}
              className="rounded-full px-4 py-1.5 text-sm bg-line">해제</button>
          ) : (
            <a href="/api/auth/google/start?calendar=1"
              className="rounded-full px-4 py-1.5 text-sm bg-accent text-white font-semibold">연결</a>
          )}
        </div>
      </section>

      <section className="bg-card border border-line rounded-2xl divide-y divide-line">
        <button onClick={exportAll} disabled={exporting} className="w-full p-4 text-left flex justify-between items-center">
          <div>
            <p className="text-sm font-semibold">전체 내보내기</p>
            <p className="text-[11px] text-ink-soft">일기 Markdown + 기록 JSON + 썸네일 zip</p>
          </div>
          <span className="text-ink-soft text-sm">{exporting ? "생성 중…" : "→"}</span>
        </button>
        <a href="/api/auth/logout" className="block w-full p-4 text-left text-sm font-semibold">로그아웃</a>
        <button onClick={deleteAccount} className="w-full p-4 text-left text-sm font-semibold text-red-500">
          계정 삭제
        </button>
      </section>

      <section className="text-[11px] text-ink-soft leading-relaxed px-1 pb-4">
        <p className="font-semibold mb-1">프라이버시 원칙</p>
        <p>
          ① AI 처리엔 해당 순간에 필요한 최소한의 증거만 전달해요 ② 사진 원본은 기기에 남고 서버엔 축소본만 저장돼요
          ③ 당신의 데이터는 AI 학습에 사용되지 않고, 광고는 영원히 없어요 ④ 기록을 지우면 파생 데이터(캡션·검색 인덱스)도 함께 지워져요
          ⑤ 내보내기는 언제나 열려 있어요
        </p>
      </section>
    </main>
  );
}
