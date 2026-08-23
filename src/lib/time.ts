// KST(Asia/Seoul) 고정 시간 유틸 — MVP는 ko-KR/KST 전제

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Date → KST 기준 YYYY-MM-DD */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD의 KST 자정 ~ 익일 자정 (UTC Date 쌍) */
export function kstDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** timestamptz → KST HH:MM */
export function kstTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/** KST 기준 시간대 라벨 (아침/점심/오후/저녁/밤) */
export function kstDayPart(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const h = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }).format(d));
  if (h < 6) return "새벽";
  if (h < 11) return "아침";
  if (h < 14) return "점심";
  if (h < 18) return "오후";
  if (h < 21) return "저녁";
  return "밤";
}

/** 해당 주(월요일 시작)의 시작일 YYYY-MM-DD — date는 KST 달력 날짜 문자열 */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return kstDateString(new Date(d.getTime() + n * 24 * 60 * 60 * 1000 + 1));
}

/** 두 좌표 사이 거리(m) — Haversine */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
