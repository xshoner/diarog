"use client";

import type { Moment, Evidence } from "@/lib/types";

// 근거 배지 칩 (§5.3-2) — 신뢰의 UI적 표현
const BADGE: Record<string, { icon: string; label: string }> = {
  photo: { icon: "📷", label: "사진 확인" },
  calendar: { icon: "📅", label: "캘린더 일치" },
  poi: { icon: "📍", label: "장소 확인" },
  interpolated_gps: { icon: "📍", label: "위치 추정" },
  weather: { icon: "🌤️", label: "날씨" },
  receipt: { icon: "🧾", label: "영수증" },
  user_answer: { icon: "✅", label: "내가 확인" },
};

export default function EvidenceBadges({ moment, evidence }: { moment: Moment; evidence: Evidence[] }) {
  const mine = evidence.filter((e) => e.moment_id === moment.id);
  const uncertainLink = moment.link_confidence != null && moment.link_confidence < 0.75 && moment.link_confidence >= 0.45;
  return (
    <div className="flex flex-wrap gap-1.5">
      {mine.map((e) => {
        const b = BADGE[e.type];
        if (!b) return null;
        const uncertain = e.type === "calendar" && uncertainLink;
        return (
          <span key={e.id}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent-soft text-ink ${uncertain ? "uncertain" : ""}`}
            title={uncertain ? "확신도가 낮은 연결이에요" : b.label}>
            <span>{b.icon}</span>{b.label}
            {e.type === "calendar" && e.score != null && (
              <span className="text-ink-soft">{Math.round(Number(e.score) * 100)}%</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
