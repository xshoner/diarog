import { env } from "./env";

// 카카오 로컬 API — 역지오코딩 + 반경 POI 후보 (FR-3.2)

export interface PoiCandidate {
  name: string;
  category: string;
  distance: number; // m
  lat: number;
  lng: number;
  address: string;
}

async function kakaoGet(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/${path}?${qs}`, {
      headers: { Authorization: `KakaoAK ${env.kakaoRestKey()}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 좌표 → 행정동 주소 문자열 */
export async function coordToAddress(lat: number, lng: number): Promise<string | null> {
  const json = await kakaoGet("geo/coord2address.json", { x: String(lng), y: String(lat) });
  const docs = (json?.documents ?? []) as Array<{ address?: { address_name?: string }; road_address?: { address_name?: string } }>;
  const d = docs[0];
  return d?.road_address?.address_name || d?.address?.address_name || null;
}

/** 좌표 → 반경 150m 장소 후보 최대 5건 (거리순) */
export async function nearbyPois(lat: number, lng: number, radius = 150): Promise<PoiCandidate[]> {
  const json = await kakaoGet("search/category.json", {
    category_group_code: "FD6", x: String(lng), y: String(lat), radius: String(radius), sort: "distance", size: "5",
  });
  // 카테고리 검색은 그룹코드 필수라 커버리지가 좁다 → 키워드 없는 전체 검색은 불가.
  // 전략: 주요 그룹코드 3종(음식점 FD6, 카페 CE7, 문화 CT1) + 키워드 검색 보강.
  const groups = ["CE7", "CT1", "AT4", "SW8"];
  const all: PoiCandidate[] = docsToPois(json);
  for (const g of groups) {
    if (all.length >= 8) break;
    const j = await kakaoGet("search/category.json", {
      category_group_code: g, x: String(lng), y: String(lat), radius: String(radius), sort: "distance", size: "3",
    });
    all.push(...docsToPois(j));
  }
  all.sort((a, b) => a.distance - b.distance);
  // 중복 제거 후 상위 5
  const seen = new Set<string>();
  const out: PoiCandidate[] = [];
  for (const p of all) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

function docsToPois(json: Record<string, unknown> | null): PoiCandidate[] {
  const docs = (json?.documents ?? []) as Array<Record<string, string>>;
  return docs.map((d) => ({
    name: d.place_name,
    category: (d.category_name || "").split(">").pop()?.trim() || "",
    distance: Number(d.distance || 0),
    lat: Number(d.y),
    lng: Number(d.x),
    address: d.road_address_name || d.address_name || "",
  }));
}

/** 텍스트(일정 장소 등) → 좌표 (키워드 검색 1위) */
export async function geocodeText(text: string): Promise<{ lat: number; lng: number } | null> {
  if (!text?.trim()) return null;
  const json = await kakaoGet("search/keyword.json", { query: text.trim(), size: "1" });
  const docs = (json?.documents ?? []) as Array<Record<string, string>>;
  if (!docs[0]) return null;
  return { lat: Number(docs[0].y), lng: Number(docs[0].x) };
}
