// 핵심 로직 단위 테스트
import { toGrid, getWeather } from "../src/lib/kma";
import { kstDateString, kstDayRange, weekStartOf, addDays, distanceMeters } from "../src/lib/time";
import { clusterPhotos } from "../src/lib/assemble";
import { coordToAddress, nearbyPois, geocodeText } from "../src/lib/kakao";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`, extra ?? ""); }
}

// 1. KMA 격자 변환 (서울시청: nx=60, ny=127)
const g = toGrid(37.5665, 126.978);
check("KMA grid 서울시청", g.nx === 60 && g.ny === 127, g);

// 2. 시간 유틸
check("kstDateString 형식", /^\d{4}-\d{2}-\d{2}$/.test(kstDateString()));
const r = kstDayRange("2026-08-23");
check("kstDayRange 시작", r.start.toISOString() === "2026-08-22T15:00:00.000Z", r.start.toISOString());
check("weekStartOf 일요일→월요일", weekStartOf("2026-08-23") === "2026-08-17", weekStartOf("2026-08-23"));
check("weekStartOf 월요일 자기자신", weekStartOf("2026-08-17") === "2026-08-17");
check("addDays", addDays("2026-08-23", -30) === "2026-07-24", addDays("2026-08-23", -30));
check("distanceMeters 서울-부산 대략", Math.abs(distanceMeters(37.5665, 126.978, 35.1796, 129.0756) - 325000) < 10000);

// 3. 클러스터링 (45분/300m)
type P = { id: string; taken_at: string; lat: number | null; lng: number | null; gps_source: string; storage_mid_path: string; is_receipt: boolean };
const mk = (id: string, t: string, lat: number | null = null, lng: number | null = null): P =>
  ({ id, taken_at: t, lat, lng, gps_source: lat ? "exif" : "none", storage_mid_path: "", is_receipt: false });
const clusters = clusterPhotos([
  mk("a", "2026-08-23T03:00:00Z", 37.5665, 126.978),
  mk("b", "2026-08-23T03:20:00Z", 37.5666, 126.979),   // 같은 클러스터 (20분, ~90m)
  mk("c", "2026-08-23T03:30:00Z", 37.5445, 127.0557),  // 거리 분리 (성수동, ~7km)
  mk("d", "2026-08-23T06:00:00Z", 37.5445, 127.0557),  // 시간 분리 (150분)
] as never[]);
check("클러스터 수 = 3", clusters.length === 3, clusters.map((c: P[]) => c.map((p) => p.id)));
check("클러스터1 = a,b", clusters[0].length === 2);

// 4. 외부 API 라이브 테스트
(async () => {
  process.env.KAKAO_REST_API_KEY = "04f6807fdf18aed33473e01fe3a3ad5f";
  process.env.KMA_SERVICE_KEY = "7d7854d4983706b5dfd01dd320a72a28bbab6b6fc8b14f419da3cb972a91b2cc";

  const addr = await coordToAddress(37.5445, 127.0557);
  check("카카오 역지오코딩(성수동)", !!addr && addr.includes("성수"), addr);

  const pois = await nearbyPois(37.5445, 127.0557);
  check("카카오 POI 후보", pois.length > 0, pois.slice(0, 2));

  const geo = await geocodeText("서울숲");
  check("카카오 키워드 지오코딩", !!geo && Math.abs(geo.lat - 37.544) < 0.02, geo);

  const w = await getWeather(37.5665, 126.978, new Date());
  check("기상청 실황(서울)", w !== null && w.temp !== null, w);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail > 0 ? 1 : 0);
})();
