"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getDeviceLocation, processPhoto, uploadPhoto } from "@/lib/client";

interface Item {
  name: string;
  status: "processing" | "uploading" | "done" | "error";
  preview?: string;
  isReceipt: boolean;
}

// 사진 수집 (FR-2.1): 다중 선택 → 클라이언트 EXIF/다운스케일 → 업로드 → 재조립
export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [assembling, setAssembling] = useState(false);
  const [receiptMode, setReceiptMode] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [gpsCount, setGpsCount] = useState(0);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 30);
    const startIdx = items.length;
    setItems((prev) => [
      ...prev,
      ...list.map((f) => ({ name: f.name, status: "processing" as const, isReceipt: receiptMode })),
    ]);

    // 포토 피커가 위치 EXIF를 제거한 경우를 대비해 기기 위치를 미리 확보 (권한 거부 시 null)
    const deviceLoc = await getDeviceLocation();

    let done = 0;
    for (let i = 0; i < list.length; i++) {
      const idx = startIdx + i;
      const set = (patch: Partial<Item>) =>
        setItems((prev) => prev.map((it, j) => (j === idx ? { ...it, ...patch } : it)));
      try {
        const processed = await processPhoto(list[i], receiptMode, deviceLoc);
        set({ status: "uploading", preview: URL.createObjectURL(processed.thumb) });
        await uploadPhoto(processed);
        set({ status: "done" });
        done++;
        setDoneCount((c) => c + 1);
        if (processed.meta.lat != null) setGpsCount((c) => c + 1);
      } catch {
        set({ status: "error" });
      }
    }

    if (done > 0) {
      // 업로드 후 당일 재조립 (디바운스 대신 완료 후 1회)
      setAssembling(true);
      try { await api("/api/moments/assemble", { method: "POST", body: JSON.stringify({}) }); } catch { }
      setAssembling(false);
    }
  }

  const busy = items.some((i) => i.status === "processing" || i.status === "uploading") || assembling;

  return (
    <main className="px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold">사진 추가</h1>
        <p className="text-sm text-ink-soft">원본은 기기에 남고, 축소본만 서버로 전송돼요</p>
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
              <span className="absolute bottom-1 right-1 text-xs">
                {it.status === "done" ? "✅" : it.status === "error" ? "⚠️" : (
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

      {doneCount > 0 && !busy && gpsCount === 0 && (
        <div className="mt-4 p-3 rounded-xl bg-card border border-line text-xs text-ink-soft leading-relaxed fade-up">
          📍 올린 사진에 위치 정보가 없어 지도·이동 경로를 표시할 수 없어요.
          안드로이드는 사진 선택 화면(포토 피커)이 개인정보 보호를 위해 위치를 지운 채 전달하는 경우가 많아요.
          <b>브라우저 위치 권한을 허용</b>하면 오늘 찍은 사진에 현재 위치를 대신 기록하고,
          선택 화면에서 <b>찾아보기/파일(내 파일) 앱</b>으로 고르면 원본 위치가 유지됩니다.
        </div>
      )}

      {doneCount > 0 && !busy && (
        <button onClick={() => router.push("/")}
          className="w-full mt-5 bg-accent text-white rounded-full py-3.5 font-semibold shadow-lg shadow-accent/25 fade-up">
          {doneCount}장 업로드 완료 — 오늘 보러 가기
        </button>
      )}
    </main>
  );
}
