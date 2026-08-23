import { env } from "./env";

// 기상청 초단기실황 (FR-3.3) — 실패 시 null 반환하고 일기에서 날씨 생략(추정 서술 금지)

export interface Weather {
  temp: number | null;      // 기온 ℃
  sky: string | null;       // 맑음/구름많음/흐림 (실황엔 없음 → 강수형태로 대체)
  precip: string | null;    // 없음/비/눈/빗방울 등
  observedAt: string;       // base date/time
}

/** 위경도 → 기상청 격자 좌표 (LCC DFS) */
export function toGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD, olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

const PTY: Record<string, string> = {
  "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림",
};

/** 특정 시각(KST)·좌표의 실황 조회. 당일 데이터만 유효. */
export async function getWeather(lat: number, lng: number, at: Date): Promise<Weather | null> {
  try {
    const { nx, ny } = toGrid(lat, lng);
    const kst = new Date(at.getTime() + 9 * 3600 * 1000);
    // 실황은 매시 40분 이후 제공 → 직전 정시 사용
    let h = kst.getUTCHours();
    let d = new Date(kst);
    if (kst.getUTCMinutes() < 45) h -= 1;
    if (h < 0) { h = 23; d = new Date(kst.getTime() - 24 * 3600 * 1000); }
    const baseDate = d.toISOString().slice(0, 10).replace(/-/g, "");
    const baseTime = String(h).padStart(2, "0") + "00";
    const qs = new URLSearchParams({
      serviceKey: env.kmaKey(), dataType: "JSON", numOfRows: "10", pageNo: "1",
      base_date: baseDate, base_time: baseTime, nx: String(nx), ny: String(ny),
    });
    const base = process.env.KMA_API_BASE_URL || "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
    const res = await fetch(`${base}/getUltraSrtNcst?${qs}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.response?.body?.items?.item as Array<{ category: string; obsrValue: string }> | undefined;
    if (!items?.length) return null;
    const find = (c: string) => items.find((i) => i.category === c)?.obsrValue;
    const t1h = find("T1H");
    const pty = find("PTY");
    return {
      temp: t1h != null ? Number(t1h) : null,
      sky: null,
      precip: pty != null ? PTY[pty] ?? null : null,
      observedAt: `${baseDate} ${baseTime}`,
    };
  } catch {
    return null;
  }
}

export function weatherText(w: Weather | null): string | null {
  if (!w || w.temp == null) return null;
  const p = w.precip && w.precip !== "없음" ? `, ${w.precip}` : "";
  return `${w.temp}℃${p}`;
}
