"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, subscribePush } from "@/lib/client";
import type { Me } from "@/lib/types";

// 온보딩 (§5.1): 가치 소개 → Google 로그인 → 페르소나 → 캘린더 → 알림 → 첫 기록
const VALUE_SCREENS = [
  { emoji: "📸", title: "사진만 찍으세요", desc: "오늘의 이야기는 이미 주변 데이터 속에 있습니다. 업로드하고, 쓰고, 태그 붙이는 노동은 이제 그만." },
  { emoji: "🧩", title: "AI가 하루를 조립해요", desc: "위치·일정·날씨·장소의 증거를 엮어 하루를 '순간' 단위로 자동 구성합니다. 모든 문장엔 근거 배지가 붙어요." },
  { emoji: "🌙", title: "밤 9시, 30초면 끝", desc: "확인 버튼 몇 번이면 나의 페르소나가 쓴 오늘의 일기가 완성됩니다. 기록하지 않아도 기록되는 삶." },
];

const PERSONAS = [
  { key: "plain", name: "담백한 기록가", emoji: "📝", samples: ["정오쯤 성수동에서 김대리와 점심을 먹었다.", "파스타집이었고, 두 시간 가까이 이야기가 이어졌다.", "돌아오는 길, 날이 꽤 맑았다."] },
  { key: "essay", name: "감성 에세이스트", emoji: "🌙", samples: ["한낮의 성수동은 볕이 골목마다 고여 있었다.", "김대리와 마주 앉은 파스타집, 창가로 스며든 빛이 접시 위에 오래 머물렀다.", "이야기가 길어질수록 오후가 천천히 익어갔다."] },
  { key: "humor", name: "유머러스한 친구", emoji: "😎", samples: ["오늘 점심, 또 성수동 파스타집이었다. 이쯤 되면 단골 인증.", "김대리랑 얘기하다 보니 두 시간 순삭. 일 얘기는 10분쯤 했나.", "날씨가 좋아서 걸어왔는데, 운동했다고 치기로 했다."] },
  { key: "dry", name: "건조한 관찰자", emoji: "🔍", samples: ["12:10 성수동 소재 파스타 전문점 방문. 동행 1인(김대리).", "체류 약 110분. 대화 주제는 업무 외 다수.", "복귀 시 도보 이동. 기온 21도, 맑음."] },
];

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"value" | "login" | "persona" | "calendar" | "push" | "done">("value");
  const [valueIdx, setValueIdx] = useState(0);
  const [persona, setPersona] = useState("plain");
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const error = params.get("error");

  useEffect(() => {
    const s = params.get("step");
    api<Me>("/api/me")
      .then((m) => {
        setMe(m);
        setPersona(m.persona);
        if (m.onboarded && !s) { router.replace("/"); return; }
        setStep(s === "push" ? "push" : s === "persona" ? "persona" : "persona");
      })
      .catch(() => setStep(error ? "login" : "value"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePersona() {
    setBusy(true);
    try { await api("/api/me", { method: "PATCH", body: JSON.stringify({ persona }) }); } catch { }
    setBusy(false);
    setStep(me?.calendarConnected ? "push" : "calendar");
  }

  async function enablePush() {
    setBusy(true);
    try {
      await subscribePush(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!);
    } catch { /* iOS Safari: A2HS 필요 안내는 아래 문구로 */ }
    await api("/api/me", { method: "PATCH", body: JSON.stringify({ onboarded: true }) }).catch(() => {});
    setBusy(false);
    setStep("done");
  }

  async function skipPush() {
    await api("/api/me", { method: "PATCH", body: JSON.stringify({ onboarded: true }) }).catch(() => {});
    setStep("done");
  }

  return (
    <main className="mx-auto max-w-lg min-h-dvh flex flex-col px-6 py-10">
      {step === "value" && (
        <div className="flex-1 flex flex-col justify-center text-center fade-up" key={valueIdx}>
          <p className="text-6xl mb-6">{VALUE_SCREENS[valueIdx].emoji}</p>
          <h1 className="text-2xl font-bold mb-3">{VALUE_SCREENS[valueIdx].title}</h1>
          <p className="text-ink-soft leading-relaxed">{VALUE_SCREENS[valueIdx].desc}</p>
          <div className="flex justify-center gap-1.5 mt-8">
            {VALUE_SCREENS.map((_, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${i === valueIdx ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          <button
            onClick={() => valueIdx < 2 ? setValueIdx(valueIdx + 1) : setStep("login")}
            className="mt-10 bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25">
            {valueIdx < 2 ? "다음" : "시작하기"}
          </button>
          {valueIdx === 0 && (
            <button onClick={() => setStep("login")} className="mt-3 text-sm text-ink-soft">건너뛰기</button>
          )}
        </div>
      )}

      {step === "login" && (
        <div className="flex-1 flex flex-col justify-center text-center fade-up">
          <p className="text-5xl mb-4">🗝️</p>
          <h1 className="text-2xl font-bold mb-2">diarog</h1>
          <p className="text-ink-soft mb-8">기록하지 않아도 기록되는 삶</p>
          {error && (
            <p className="text-sm text-red-500 mb-4 bg-red-500/10 rounded-xl p-3">
              로그인에 실패했어요. 다시 시도해 주세요. <span className="text-xs opacity-70">({error})</span>
            </p>
          )}
          <a href="/api/auth/google/start"
            className="flex items-center justify-center gap-2 bg-card border border-line rounded-full py-3.5 font-semibold active:scale-[0.98] transition-transform">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C40.8 35.6 44 30.3 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
            Google로 계속하기
          </a>
          <p className="text-[11px] text-ink-soft mt-6 leading-relaxed">
            AI 처리엔 필요한 최소한의 정보만 쓰이고, 당신의 데이터는 학습에 사용되지 않으며, 광고는 영원히 없습니다.
          </p>
        </div>
      )}

      {step === "persona" && (
        <div className="flex-1 fade-up">
          <h1 className="text-xl font-bold mb-1">누가 당신의 하루를 쓸까요?</h1>
          <p className="text-sm text-ink-soft mb-5">같은 하루도 문체에 따라 달라져요. 언제든 바꿀 수 있어요.</p>
          <div className="space-y-3">
            {PERSONAS.map((p) => (
              <button key={p.key} onClick={() => setPersona(p.key)}
                className={`w-full text-left bg-card border rounded-2xl p-4 transition-all ${
                  persona === p.key ? "border-accent shadow-lg shadow-accent/10" : "border-line"
                }`}>
                <div className="flex items-center gap-2 font-semibold">
                  <span>{p.emoji}</span>{p.name}
                  {persona === p.key && <span className="ml-auto text-accent text-sm">선택됨 ✓</span>}
                </div>
                <div className="mt-2 text-[13px] text-ink-soft leading-relaxed space-y-0.5">
                  {p.samples.map((s, i) => <p key={i}>{s}</p>)}
                </div>
              </button>
            ))}
          </div>
          <button onClick={savePersona} disabled={busy}
            className="w-full mt-6 bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25 disabled:opacity-50">
            {busy ? "저장 중…" : "이 문체로 시작"}
          </button>
        </div>
      )}

      {step === "calendar" && (
        <div className="flex-1 flex flex-col justify-center text-center fade-up">
          <p className="text-5xl mb-4">📅</p>
          <h1 className="text-xl font-bold mb-2">일정과 사진을 엮으면<br />&lsquo;누구와 왜&rsquo;까지 기록됩니다</h1>
          <p className="text-sm text-ink-soft leading-relaxed mb-8">
            Google 캘린더를 읽기 전용으로만 연결해요.<br />
            일정 제목·시간·참석자만 쓰고, 상세 내용은 가져오지 않아요.
          </p>
          <a href="/api/auth/google/start?calendar=1"
            className="bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25">
            캘린더 연결하기
          </a>
          <button onClick={() => setStep("push")} className="mt-3 text-sm text-ink-soft py-2">
            나중에 할게요 (사진·장소·날씨만으로도 동작해요)
          </button>
        </div>
      )}

      {step === "push" && (
        <div className="flex-1 flex flex-col justify-center text-center fade-up">
          <p className="text-5xl mb-4">🔔</p>
          <h1 className="text-xl font-bold mb-2">밤 9시, 오늘의 기록이<br />준비되면 알려드릴게요</h1>
          <p className="text-sm text-ink-soft leading-relaxed mb-2">30초 확인이면 하루가 확정돼요. 시간은 설정에서 바꿀 수 있어요.</p>
          <p className="text-[11px] text-ink-soft mb-8">
            iPhone은 Safari 공유 → &lsquo;홈 화면에 추가&rsquo; 후에 알림을 켤 수 있어요.
          </p>
          <button onClick={enablePush} disabled={busy}
            className="bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25 disabled:opacity-50">
            {busy ? "설정 중…" : "알림 켜기"}
          </button>
          <button onClick={skipPush} className="mt-3 text-sm text-ink-soft py-2">나중에</button>
        </div>
      )}

      {step === "done" && (
        <div className="flex-1 flex flex-col justify-center text-center fade-up">
          <p className="text-5xl mb-4">🎉</p>
          <h1 className="text-xl font-bold mb-2">준비 완료!</h1>
          <p className="text-sm text-ink-soft mb-8">오늘 찍은 사진이 있다면 지금 바로 첫 기록을 만들어 보세요.</p>
          <button onClick={() => router.push("/upload")}
            className="bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25">
            첫 기록 만들기
          </button>
          <button onClick={() => router.push("/")} className="mt-3 text-sm text-ink-soft py-2">홈으로</button>
        </div>
      )}
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
