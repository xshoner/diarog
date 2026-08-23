"use client";

import type { Moment, PhotoOut, Evidence } from "@/lib/types";
import EvidenceBadges from "./EvidenceBadges";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export default function MomentCard({
  moment, photos, evidence, index, onClick, children,
}: {
  moment: Moment;
  photos: PhotoOut[];
  evidence: Evidence[];
  index: number;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const mine = photos.filter((p) => p.moment_id === moment.id);
  const cover = mine[0];
  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden fade-up" onClick={onClick}>
      <div className="flex gap-3 p-3">
        <div className="relative shrink-0">
          {cover?.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.thumbUrl} alt="" className="w-20 h-20 object-cover rounded-xl" />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-accent-soft flex items-center justify-center text-2xl">📷</div>
          )}
          <span className="absolute -top-1.5 -left-1.5 w-5.5 h-5.5 min-w-5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center shadow">
            {index + 1}
          </span>
          {mine.length > 1 && (
            <span className="absolute bottom-1 right-1 bg-black/55 text-white text-[10px] px-1.5 rounded-full">
              +{mine.length - 1}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-ink-soft tabular-nums">{timeLabel(moment.starts_at)}</span>
            {moment.status === "soft_confirmed" && (
              <span className="text-[10px] text-warn border border-warn/40 rounded-full px-1.5">미확인</span>
            )}
            {moment.mood && <span className="text-sm">{moment.mood}</span>}
          </div>
          <h3 className="font-semibold text-[15px] leading-snug mt-0.5 truncate">{moment.title ?? "제목 없음"}</h3>
          {(moment.place_name || moment.address) && (
            <p className="text-xs text-ink-soft mt-0.5 truncate">
              {moment.place_name ?? moment.address}
              {moment.people?.length > 0 && ` · ${moment.people.map((p) => p.name).join(", ")}`}
            </p>
          )}
          <div className="mt-1.5">
            <EvidenceBadges moment={moment} evidence={evidence} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
