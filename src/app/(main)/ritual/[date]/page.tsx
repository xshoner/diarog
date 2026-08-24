"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { DayBundle, DiaryEntry, Moment, PhotoOut } from "@/lib/types";
import KakaoMap from "@/components/KakaoMap";
import MomentCard from "@/components/MomentCard";
import DiaryView from "@/components/DiaryView";

const MOODS = ["😊", "😌", "🥳", "😴", "😤", "🥲"];

// 21:00 확인 리추얼 (§5.3) — 목표 30~90초
export default function RitualPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const router = useRouter();
  const [bundle, setBundle] = useState<DayBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [diary, setDiary] = useState<DiaryEntry | null>(null);
  const editCount = useRef(0);
  const sessionStart = useRef(0);

  useEffect(() => {
    if (sessionStart.current === 0) sessionStart.current = Date.now();
    // 홈에서 특정 순간을 탭해 들어온 경우 해당 편집기를 바로 연다 (?m=momentId)
    const m = new URLSearchParams(window.location.search).get("m");
    if (m) setEditingId(m);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await api<DayBundle>(`/api/days/${date}`);
      setBundle(b);
      if (b.diary) setDiary(b.diary);
    } catch { }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function answerQuestion(qid: string, answer: string) {
    try {
      await api(`/api/questions/${qid}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
      editCount.current++;
      await load();
    } catch { }
  }

  async function patchMoment(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/moments/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      editCount.current++;
      await load();
    } catch { }
  }

  async function confirmDay() {
    setConfirming(true);
    try {
      const res = await api<{ diary: { sentences: DiaryEntry["sentences"]; oneLine: string; body: string } }>(
        `/api/days/${date}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            editCount: editCount.current,
            sessionMs: Date.now() - sessionStart.current,
            zeroEntry: editCount.current === 0,
          }),
        }
      );
      setDiary({
        date, body_final: res.diary.body, one_line: res.diary.oneLine,
        sentences: res.diary.sentences, edited: false,
      });
      await load();
    } catch (e) {
      alert(`일기 생성에 실패했어요. 잠시 후 다시 시도해 주세요.\n${e instanceof Error ? e.message : ""}`);
    }
    setConfirming(false);
  }

  const moments = bundle?.moments ?? [];
  const drafts = moments.filter((m) => m.status === "draft");
  const questions = bundle?.questions ?? [];
  const allConfirmed = moments.length > 0 && drafts.length === 0;

  if (loading && !bundle) {
    return (
      <main className="px-4 pt-6 space-y-3">
        <div className="h-32 rounded-2xl bg-card border border-line pulse-soft" />
        <div className="h-24 rounded-2xl bg-card border border-line pulse-soft" />
      </main>
    );
  }

  return (
    <main className="px-4 pt-5 pb-28">
      <header className="mb-4">
        <button onClick={() => router.push("/")} className="text-sm text-ink-soft mb-2">← 홈</button>
        <h1 className="text-xl font-bold">오늘의 기록</h1>
        <p className="text-sm text-ink-soft">
          {allConfirmed ? "오늘 하루가 확정됐어요 ✨" : `${drafts.length}개의 순간을 확인해 주세요 — 30초면 충분해요`}
        </p>
      </header>

      <KakaoMap moments={moments} className="h-40 mb-4" />

      {/* 버튼 질문 (§5.3-3): 세션당 최대 3개 */}
      {questions.slice(0, 3).map((q) => (
        <div key={q.id} className="bg-accent-soft border border-accent/30 rounded-2xl p-4 mb-3 fade-up">
          <p className="text-sm font-semibold mb-2.5">🤔 {q.question_text}</p>
          <div className="flex flex-wrap gap-2">
            {(q.options ?? ["맞아요", "아니에요"]).map((opt: string) => (
              <button key={opt} onClick={() => answerQuestion(q.id, opt)}
                className="bg-card border border-line rounded-full px-4 py-1.5 text-sm font-medium active:scale-95 transition-transform">
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-3">
        {moments.map((m, i) => (
          <MomentCard key={m.id} moment={m} photos={bundle!.photos} evidence={bundle!.evidence} index={i}
            onClick={() => setEditingId(editingId === m.id ? null : m.id)}>
            {editingId === m.id && (
              <InlineEditor moment={m}
                photos={(bundle!.photos ?? []).filter((p) => p.moment_id === m.id)}
                onDeletePhoto={async (pid) => {
                  if (!confirm("이 사진을 삭제할까요? 되돌릴 수 없어요.")) return;
                  await api(`/api/photos/${pid}`, { method: "DELETE" });
                  editCount.current++;
                  await load();
                }}
                onSave={(body) => { patchMoment(m.id, body); setEditingId(null); }}
                onDelete={async () => {
                  if (!confirm("이 순간을 삭제할까요? 사진은 남고 기록만 사라져요.")) return;
                  await api(`/api/moments/${m.id}`, { method: "DELETE" });
                  editCount.current++;
                  setEditingId(null);
                  await load();
                }} />
            )}
          </MomentCard>
        ))}
      </div>

      {diary && (
        <section className="mt-5 fade-up">
          <h2 className="text-sm font-semibold text-ink-soft px-1 mb-2">오늘의 일기</h2>
          <DiaryView diary={diary} date={date} onChanged={async () => { setDiary(null); await load(); }} />
          <button onClick={() => router.push("/")}
            className="w-full mt-4 bg-card border border-line rounded-full py-3 font-semibold">
            저장하고 홈으로
          </button>
        </section>
      )}

      {/* 하단 고정 확정 버튼 (§5.3-5) — 일기가 있어도 새 draft가 있으면 재확정 가능 */}
      {moments.length > 0 && (drafts.length > 0 || !diary) && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-lg px-4 z-30">
          <button onClick={confirmDay} disabled={confirming}
            className="w-full bg-accent text-white rounded-full py-4 font-bold text-[15px] shadow-xl shadow-accent/30 active:scale-[0.99] transition-transform disabled:opacity-70">
            {confirming ? (
              <span className="pulse-soft">나의 페르소나가 일기를 쓰는 중…</span>
            ) : diary ? (
              `새 순간 ${drafts.length}개를 일기에 반영하기`
            ) : (
              "오늘 하루 확정하기"
            )}
          </button>
        </div>
      )}

      {moments.length === 0 && (
        <div className="text-center py-12 text-ink-soft text-sm">
          이 날의 기록이 없어요. <button onClick={() => router.push("/upload")} className="text-accent font-semibold">사진 추가하기</button>
        </div>
      )}
    </main>
  );
}

function InlineEditor({ moment, photos, onSave, onDelete, onDeletePhoto }: {
  moment: Moment;
  photos: PhotoOut[];
  onSave: (body: Record<string, unknown>) => void;
  onDelete: () => void;
  onDeletePhoto: (photoId: string) => void;
}) {
  const [title, setTitle] = useState(moment.title ?? "");
  const [place, setPlace] = useState(moment.place_name ?? "");
  const [memo, setMemo] = useState(moment.memo ?? "");
  const [mood, setMood] = useState(moment.mood ?? "");
  const [peopleText, setPeopleText] = useState((moment.people ?? []).map((p) => p.name).join(", "));

  const hasAi = !!(moment.ai?.scene_summary || moment.ai?.facts?.length || moment.ai?.inferences?.length);

  return (
    <div className="border-t border-line p-3 space-y-2.5 bg-paper/50" onClick={(e) => e.stopPropagation()}>
      {hasAi && (
        <div className="bg-card border border-line rounded-xl p-2.5 text-xs leading-relaxed space-y-1">
          <p className="font-semibold text-ink-soft">🤖 AI가 사진·일정·날씨에서 파악한 내용</p>
          {moment.ai?.scene_summary && <p>{moment.ai.scene_summary}</p>}
          {(moment.ai?.facts ?? []).map((f, i) => (
            <p key={`f${i}`} className="text-ink-soft">• {f}</p>
          ))}
          {(moment.ai?.inferences ?? []).map((x, i) => (
            <p key={`i${i}`} className="text-ink-soft/80">≈ {x.text} {x.confidence != null && `(확신 ${Math.round(x.confidence * 100)}%)`}</p>
          ))}
          {(moment.address || moment.weather?.temp != null) && (
            <p className="text-ink-soft pt-0.5">
              {moment.address && `📍 ${moment.address}`}
              {moment.address && moment.weather?.temp != null && " · "}
              {moment.weather?.temp != null && `🌡 ${moment.weather.temp}℃${moment.weather.precip && moment.weather.precip !== "없음" ? ` ${moment.weather.precip}` : ""}`}
            </p>
          )}
        </div>
      )}
      {!hasAi && (
        <p className="text-xs text-ink-soft">
          이 순간은 AI 분석 정보가 없어요. 사진에 위치가 있으면 장소·날씨가 자동으로 채워져요.
        </p>
      )}
      {photos.length > 0 && (
        <div>
          <span className="text-xs text-ink-soft">사진 {photos.length}장 (✕를 눌러 삭제)</span>
          <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
            {photos.map((p) => (
              <div key={p.id} className="relative shrink-0">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-line" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-card border border-line flex items-center justify-center">📷</div>
                )}
                <button onClick={() => onDeletePhoto(p.id)} aria-label="사진 삭제"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[11px] leading-none flex items-center justify-center">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <label className="block text-xs text-ink-soft">
        제목
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <label className="block text-xs text-ink-soft">
        장소 (입력하면 지도 위치·주소·날씨도 함께 갱신돼요)
        <input value={place} onChange={(e) => setPlace(e.target.value)}
          placeholder="예: 충주 중앙경찰학교"
          className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <label className="block text-xs text-ink-soft">
        함께한 사람 (쉼표로 구분)
        <input value={peopleText} onChange={(e) => setPeopleText(e.target.value)}
          className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <label className="block text-xs text-ink-soft">
        한줄 메모
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="이 순간에 대해 남기고 싶은 말"
          className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
      </label>
      <div>
        <span className="text-xs text-ink-soft">기분 (선택)</span>
        <div className="flex gap-1.5 mt-1">
          {MOODS.map((m) => (
            <button key={m} onClick={() => setMood(mood === m ? "" : m)}
              className={`text-xl p-1 rounded-lg ${mood === m ? "bg-accent-soft scale-110" : "opacity-60"} transition-all`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({
            title, placeName: place, memo, mood: mood || null,
            people: peopleText.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name, source: "user" })),
          })}
          className="flex-1 bg-accent text-white rounded-full py-2 text-sm font-semibold">
          저장
        </button>
        <button onClick={onDelete} className="px-4 text-sm text-red-500">삭제</button>
      </div>
    </div>
  );
}
