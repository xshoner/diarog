"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, GeoReason, processPhoto, requestDeviceLocation, uploadPhoto } from "@/lib/client";

interface Item {
  name: string;
  status: "processing" | "uploading" | "done" | "duplicate" | "error";
  preview?: string;
  isReceipt: boolean;
  hasGps?: boolean;
}

// 화면 우측 하단에 표시되는 빌드 표식 — 폰이 옛 번들을 캐시 중인지 판별용
const UI_BUILD = "v9";
type Assembly = { moments: number; context?: { supplied: number; cited: number; memories: number; interpreted: number; signalsAvailable: boolean; memoriesAvailable: boolean; truncated: boolean; sourceCounts: Record<string, number> } };

// 사진 수집 (FR-2.1): 다중 선택 → 클라이언트 EXIF/다운스케일 → 업로드 → 재조립
export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [assembling, setAssembling] = useState(false);
  const [receiptMode, setReceiptMode] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [gpsCount, setGpsCount] = useState(0);
  const [dupCount, setDupCount] = useState(0);
  const [assemblyNotes, setAssemblyNotes] = useState<Record<string, string>>({});
  const [geo, setGeo] = useState<{ loc: { lat: number; lng: number } | null; reason: GeoReason | "checking" }>(
    { loc: null, reason: "checking" });
  const geoPromise = useRef<ReturnType<typeof requestDeviceLocation> | null>(null);

  // 페이지 진입 즉시 위치 요청 — 권한 팝업이 사진 선택 전에 뜨도록
  const requestGeo = useCallback(() => {
    setGeo({ loc: null, reason: "checking" });
    const p = requestDeviceLocation();
    geoPromise.current = p;
    p.then(setGeo);
    return p;
  }, []);
  useEffect(() => { requestGeo(); }, [requestGeo]);

  async function assembleWithContext(date: string) {
    const result = await api<Assembly>("/api/moments/assemble", { method: "POST", body: JSON.stringify({ date }) });
    const c = result.context;
    const message = !c ? "새로 분석할 사진이 없습니다. 확정된 순간·일기는 유지됩니다."
      : `${result.moments}개 순간 분석 · 통화 ${c.sourceCounts.audio ?? 0}개, 위치 ${c.sourceCounts.location ?? 0}개, 걸음 집계 ${c.sourceCounts.steps ?? 0}개, 기억 ${c.memories}개 제공. AI 근거 선택 ${c.cited}개.` +
        (c.interpreted < result.moments ? " 일부 AI 분석 실패/사용량 제한으로 기본 제목을 저장했습니다." : "") +
        (!c.signalsAvailable || !c.memoriesAvailable ? " 일부 자료 조회 실패 — 다시 반영해 주세요." : "") +
        (c.truncated ? " 그날 최근 1,000개 기록 범위에서 선택했습니다." : "");
    setAssemblyNotes(prev => ({ ...prev, [date]: message }));
  }
  async function refreshContext(date: string) {
    setAssembling(true);
    try { await assembleWithContext(date); }
    catch { setAssemblyNotes(prev => ({ ...prev, [date]: "맥락 분석 실패. 사진은 유지됩니다. 다시 시도해 주세요." })); }
    finally { setAssembling(false); }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 30);
    const startIdx = items.length;
    setItems((prev) => [
      ...prev,
      ...list.map((f) => ({ name: f.name, status: "processing" as const, isReceipt: receiptMode })),
    ]);

    // 포토 피커가 위치 EXIF를 제거한 경우를 대비해 기기 위치 사용 (권한 거부 시 null).
    // 페이지 로드 때 실패했더라도 업로드 시점에 한 번 더 시도한다.
    let geoRes = await (geoPromise.current ?? requestGeo());
    if (!geoRes.loc) geoRes = await requestGeo();
    const deviceLoc = geoRes.loc;

    let done = 0;
    const uploadedDates = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const idx = startIdx + i;
      const set = (patch: Partial<Item>) =>
        setItems((prev) => prev.map((it, j) => (j === idx ? { ...it, ...patch } : it)));
      try {
        const processed = await processPhoto(list[i], receiptMode, deviceLoc);
        // 위치 파이프라인 진단 정보를 모든 사진에 기록 (버전/사유/기기위치 확보 여부)
        processed.meta.exif.geoReason = geoRes.reason;
        processed.meta.exif.hadDeviceLoc = !!deviceLoc;
        processed.meta.exif.appBuild = UI_BUILD;
        const hasGps = processed.meta.lat != null;
        set({ status: "uploading", preview: URL.createObjectURL(processed.thumb), hasGps });
        const res = await uploadPhoto(processed);
        if (res.duplicate) {
          set({ status: "duplicate" });
          setDupCount((c) => c + 1);
          continue; // 이미 등록된 사진 — 재조립 불필요
        }
        set({ status: "done" });
        done++;
        if (res.takenAt) {
          const kst = new Date(new Date(res.takenAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
          uploadedDates.add(kst);
        }
        setDoneCount((c) => c + 1);
        if (hasGps) setGpsCount((c) => c + 1);
      } catch {
        set({ status: "error" });
      }
    }

    if (done > 0) {
      // 업로드된 각 사진의 촬영일 기준으로 재조립한다.
      // 과거 사진도 언제든 해당 날짜의 일기로 자동 반영되도록 오늘 날짜에 한정하지 않는다.
      setAssembling(true);
      try {
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        for (const date of uploadedDates) {
          try { await assembleWithContext(date); }
          catch { setAssemblyNotes(prev => ({ ...prev, [date]: "사진 업로드 완료 · 맥락 분석 실패. 다시 반영해 주세요." })); continue; }
          // 지난 날짜에 사진을 뒤늦게 추가한 경우에는 새 Moment를 자동 확정하고
          // 일기 본문까지 재생성해 "나중에 올려도 기록이 완성되는" 경험을 제공한다.
          if (date < today) {
            try {
              const result = await api<{ skipped?: boolean; learning?: { memoryUpdated: boolean } }>(`/api/days/${date}/confirm`, {
                method: "POST", body: JSON.stringify({ zeroEntry: true, source: "historical_photo_upload", preserveExisting: true }),
              });
              const note = result.skipped ? " 기존 일기는 유지했습니다. 새 순간은 해당 날짜에서 확인하세요." : result.learning?.memoryUpdated === false
                ? " 일기 저장 완료 · 기억 갱신 실패. 개인화 화면에서 재시도하세요." : " 일기와 기억 갱신 완료.";
              setAssemblyNotes(prev => ({ ...prev, [date]: (prev[date] ?? "") + note }));
            } catch { setAssemblyNotes(prev => ({ ...prev, [date]: (prev[date] ?? "") + " 일기 생성 실패. 해당 날짜에서 다시 시도해 주세요." })); }
          }
        }
      } finally {
        setAssembling(false);
      }
    }
  }

  const busy = items.some((i) => i.status === "processing" || i.status === "uploading") || assembling;

  return (
    <main className="px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold">사진 추가</h1>
        <p className="text-sm text-ink-soft">원본은 기기에 남고, 축소본만 서버로 전송돼요</p>
        <div className="mt-2 text-xs">
          <span className="text-ink-soft/50 mr-1.5">{UI_BUILD}</span>
          {geo.reason === "checking" && (
            <span className="text-ink-soft pulse-soft">📍 현재 위치 확인 중…</span>
          )}
          {geo.reason === "ok" && (
            <span className="text-accent">📍 위치 사용 가능 — 사진에 위치가 없으면 현재 위치로 채워요</span>
          )}
          {geo.reason !== "checking" && geo.reason !== "ok" && (
            <span className="text-warn">
              ⚠️ 위치를 가져올 수 없어요 — {
                geo.reason === "denied" ? "권한이 거부됐어요. 브라우저 설정 > 사이트 권한 > 위치를 허용해 주세요" :
                geo.reason === "timeout" ? "응답 시간 초과 (휴대폰 위치(GPS)가 켜져 있는지 확인)" :
                geo.reason === "unsupported" ? "이 브라우저는 위치를 지원하지 않아요" :
                "휴대폰 위치(GPS)가 꺼져 있는 것 같아요"
              }
              <button onClick={requestGeo} className="ml-1.5 underline font-semibold">다시 시도</button>
            </span>
          )}
        </div>
      </header>

      <input ref={inputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />

      <button onClick={() => inputRef.current?.click()} disabled={busy}
        className="w-full h-40 border-2 border-dashed border-line rounded-2xl bg-card flex flex-col items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-50">
        <span className="text-4xl">{receiptMode ? "🧾" : "📷"}</span>
        <span className="font-semibold">{receiptMode ? "영수증 촬영/선택" : "사진 선택하기"}</span>
        <span className="text-xs text-ink-soft">여러 장을 한 번에 선택할 수 있어요</span>
      </button>

      <label className="flex items-center gap-2 mt-3 px-1 text-sm text-ink-soft">
        <input type="checkbox" checked={receiptMode} onChange={(e) => setReceiptMode(e.target.checked)}
          className="accent-[var(--color-accent)]" />
        영수증이에요 (상호·금액을 자동 인식해 기록이 더 정확해져요)
      </label>

      {items.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mt-4">
          {items.map((it, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-card border border-line">
              {it.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.preview} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl pulse-soft">📷</div>
              )}
              {(it.status === "done" || it.status === "uploading") && (
                <span className="absolute top-1 left-1 text-[10px] bg-black/55 text-white px-1 rounded-full">
                  {it.hasGps ? "📍" : "위치없음"}
                </span>
              )}
              <span className="absolute bottom-1 right-1 text-xs">
                {it.status === "done" ? "✅" : it.status === "duplicate" ? "♻️" : it.status === "error" ? "⚠️" : (
                  <span className="pulse-soft">⏳</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {assembling && (
        <p className="text-center text-sm text-accent mt-4 pulse-soft">AI가 순간을 조립하는 중…</p>
      )}
      {Object.keys(assemblyNotes).length > 0 && <section className="mt-4 bg-card border border-line rounded-xl p-3 space-y-3">
        <h2 className="text-sm font-semibold">사진과 함께 참고한 내 기록</h2>
        <p className="text-xs text-ink-soft">촬영 시각 주변의 통화·위치, 그날 걸음 수와 기존 기억을 참고합니다. 아직 휴대폰에서 동기화하지 않은 기록은 포함되지 않습니다.</p>
        {Object.entries(assemblyNotes).map(([date, message]) => <div key={date} className="text-xs space-y-2">
          <p role="status">{date} · {message}</p>
          <button disabled={busy} onClick={() => refreshContext(date)} className="text-accent underline mr-3">동기화한 기록 다시 반영</button>
          <Link href={`/ritual/${date}`} className="underline">이 날짜 확인</Link>
        </div>)}
        <p className="text-xs text-ink-soft">다시 반영은 미확정 사진 순간만 분석합니다. 확정한 순간과 일기를 바꾸려면 해당 날짜에서 직접 수정·다시 쓰기를 선택하세요.</p>
        <Link href="/persona" className="text-xs text-accent underline">학습·활용 이력 확인</Link>
      </section>}

      {dupCount > 0 && !busy && (
        <p className="text-center text-xs text-ink-soft mt-3">
          ♻️ 이미 등록된 사진 {dupCount}장은 건너뛰었어요
        </p>
      )}

      {doneCount > 0 && !busy && (
        <p className="text-center text-xs text-ink-soft mt-3">
          📍 위치 기록: {gpsCount}/{doneCount}장
        </p>
      )}

      {doneCount > 0 && !busy && gpsCount === 0 && (
        <div className="mt-2 p-3 rounded-xl bg-card border border-line text-xs text-ink-soft leading-relaxed fade-up">
          📍 위치 정보가 없는 사진도 등록할 수 있어요. 과거 사진은 촬영일 기준으로 해당 날짜의 일기에 자동 반영되고,\n          EXIF 위치가 있으면 지도에도 함께 기록됩니다. 위치가 없는 과거 사진에는 현재 위치를 잘못 붙이지 않아요.
        </div>
      )}

      {(doneCount > 0 || dupCount > 0) && !busy && (
        <button onClick={() => router.push("/")}
          className="w-full mt-5 bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25 fade-up">
          {doneCount > 0 ? `${doneCount}장 업로드 완료 — 오늘 보러 가기` : "오늘 보러 가기"}
        </button>
      )}
    </main>
  );
}
