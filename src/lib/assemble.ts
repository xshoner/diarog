import { db, PHOTO_BUCKET } from "./supabase";
import { chatJSON, ChatMessage, AiLimitError } from "./letsur";
import { coordToAddress, nearbyPois, PoiCandidate } from "./kakao";
import { getWeather, Weather } from "./kma";
import { distanceMeters, kstDayRange, kstDayPart, kstTime } from "./time";

// Moment 조립 엔진 (Context Broker) — FR-4
// 파라미터 외부화 (FR-4.1)
const GAP_MINUTES = Number(process.env.CLUSTER_GAP_MINUTES ?? 45);
const GAP_METERS = Number(process.env.CLUSTER_GAP_METERS ?? 300);
const AUTO_LINK = Number(process.env.CONF_AUTO_LINK ?? 0.75);
const ASK_MIN = Number(process.env.CONF_ASK_MIN ?? 0.45);
const MAX_QUESTIONS_PER_DAY = 3;
const MAX_IMAGES_PER_CALL = 6;

interface PhotoRow {
  id: string;
  taken_at: string;
  lat: number | null;
  lng: number | null;
  gps_source: string;
  storage_mid_path: string;
  is_receipt: boolean;
}

interface CalEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  loc_lat: number | null;
  loc_lng: number | null;
  attendees: Array<{ name: string; email?: string }>;
}

interface Call1Result {
  scene_summary?: string;
  ocr_texts?: string[];
  title_candidates?: string[];
  place_match?: { poi_index?: number | null; confidence?: number };
  event_match?: { event_id?: string | null; confidence?: number; reason?: string };
  facts?: string[];
  inferences?: Array<{ text: string; confidence?: number }>;
  question_candidates?: Array<{ q: string; options?: string[]; target?: string }>;
  receipt?: { store?: string; amount?: number | null; time?: string } | null;
}

/** GPS 누락 사진 보간 (FR-2.3) — 인접 사진 GPS 사용, 확신도 가점 없음 */
function interpolateGps(photos: PhotoRow[]): void {
  const withGps = photos.filter((p) => p.lat != null);
  if (withGps.length === 0) return;
  for (const p of photos) {
    if (p.lat != null) continue;
    const t = new Date(p.taken_at).getTime();
    let best: PhotoRow | null = null;
    let bestDt = Infinity;
    for (const g of withGps) {
      const dt = Math.abs(new Date(g.taken_at).getTime() - t);
      if (dt < bestDt) { bestDt = dt; best = g; }
    }
    if (best && bestDt <= 90 * 60 * 1000) {
      p.lat = best.lat;
      p.lng = best.lng;
      p.gps_source = "interpolated";
    }
  }
}

/** 시간 45분 / 거리 300m 초과 시 분리 (FR-4.1) */
export function clusterPhotos(photos: PhotoRow[]): PhotoRow[][] {
  const sorted = [...photos].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const clusters: PhotoRow[][] = [];
  let cur: PhotoRow[] = [];
  for (const p of sorted) {
    if (cur.length === 0) { cur.push(p); continue; }
    const last = cur[cur.length - 1];
    const dtMin = (new Date(p.taken_at).getTime() - new Date(last.taken_at).getTime()) / 60000;
    let dMeters = 0;
    if (p.lat != null && last.lat != null) {
      dMeters = distanceMeters(last.lat!, last.lng!, p.lat!, p.lng!);
    }
    if (dtMin > GAP_MINUTES || dMeters > GAP_METERS) {
      clusters.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

function centroid(photos: PhotoRow[]): { lat: number; lng: number } | null {
  const g = photos.filter((p) => p.lat != null);
  if (!g.length) return null;
  return {
    lat: g.reduce((s, p) => s + p.lat!, 0) / g.length,
    lng: g.reduce((s, p) => s + p.lng!, 0) / g.length,
  };
}

/** 시간 겹침 0~0.4 + 거리 근접 0~0.3 (FR-4.2 휴리스틱) */
function heuristicScore(mStart: Date, mEnd: Date, c: { lat: number; lng: number } | null, ev: CalEvent): { time: number; dist: number } {
  const es = new Date(ev.starts_at).getTime();
  const ee = ev.ends_at ? new Date(ev.ends_at).getTime() : es + 3600_000;
  const ms = mStart.getTime();
  const me = Math.max(mEnd.getTime(), ms + 10 * 60000); // 최소 10분 창
  const overlap = Math.max(0, Math.min(me, ee) - Math.max(ms, es));
  const timeScore = 0.4 * Math.min(1, overlap / Math.min(me - ms, ee - es || 3600_000));
  let distScore = 0;
  if (c && ev.loc_lat != null && ev.loc_lng != null) {
    const d = distanceMeters(c.lat, c.lng, ev.loc_lat, ev.loc_lng);
    distScore = d <= 100 ? 0.3 : d <= 300 ? 0.2 : d <= 1000 ? 0.1 : 0;
  }
  return { time: timeScore, dist: distScore };
}

async function photoAsDataUri(path: string): Promise<string | null> {
  try {
    const { data } = await db().storage.from(PHOTO_BUCKET).download(path);
    if (!data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    const mime = path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Call-1: Moment 해석 (§8.2) */
async function interpretMoment(
  userId: string,
  photos: PhotoRow[],
  address: string | null,
  pois: PoiCandidate[],
  events: CalEvent[],
  weather: Weather | null,
): Promise<Call1Result | null> {
  // 대표 이미지 선별: 시간 분산 (최대 6장)
  const picked: PhotoRow[] = [];
  const step = Math.max(1, Math.floor(photos.length / MAX_IMAGES_PER_CALL));
  for (let i = 0; i < photos.length && picked.length < MAX_IMAGES_PER_CALL; i += step) picked.push(photos[i]);

  const images: Array<{ type: "image_url"; image_url: { url: string } }> = [];
  for (const p of picked) {
    const uri = await photoAsDataUri(p.storage_mid_path);
    if (uri) images.push({ type: "image_url", image_url: { url: uri } });
  }

  const ctx = {
    촬영시각: photos.map((p) => kstTime(p.taken_at)),
    시간대: kstDayPart(photos[0].taken_at),
    주소: address,
    장소후보: pois.map((p, i) => ({ index: i, 이름: p.name, 카테고리: p.category, 거리m: p.distance })),
    일정후보: events.slice(0, 3).map((e) => ({
      event_id: e.id, 제목: e.title,
      시작: kstTime(e.starts_at), 종료: e.ends_at ? kstTime(e.ends_at) : null,
      장소: e.location_text, 참석자: e.attendees.map((a) => a.name),
    })),
    날씨: weather ? { 기온: weather.temp, 강수: weather.precip } : null,
    영수증포함: photos.some((p) => p.is_receipt),
  };

  const system = [
    "너는 증거 기반 사건 해석기다. 사진과 컨텍스트에서 확인 가능한 것만 사실로 기술하고, 확인 불가한 것은 추정으로 분리한다. 근거 없는 서술은 금지.",
    "제목 후보는 한국어로, '장소에서 한 일' 형식의 자연스러운 구 형태로 (예: '성수동 파스타집에서 점심').",
    "영수증 사진이 있으면 receipt에 상호/금액/시각을 추출한다. 없으면 receipt는 null.",
    "반드시 아래 JSON 스키마로만 응답한다. 다른 텍스트 금지:",
    JSON.stringify({
      scene_summary: "string(사진에서 직접 확인되는 것만)",
      ocr_texts: ["간판/영수증 텍스트"],
      title_candidates: ["string", "string"],
      place_match: { poi_index: 0, confidence: 0.0 },
      event_match: { event_id: "string|null", confidence: 0.0, reason: "string" },
      facts: ["확인된 사실"],
      inferences: [{ text: "추정 서술", confidence: 0.0 }],
      question_candidates: [{ q: "string", options: ["맞아요", "아니에요"], target: "event_link|people|place" }],
      receipt: { store: "", amount: null, time: "" },
    }),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: `컨텍스트:\n${JSON.stringify(ctx, null, 1)}\n\n사진들을 분석하고 JSON으로 응답하라.` },
        ...images,
      ],
    },
  ];

  try {
    return await chatJSON<Call1Result>(messages, { userId, kind: "call1", maxTokens: 5000 });
  } catch (e) {
    if (e instanceof AiLimitError) throw e;
    return null; // 폴백: 규칙 기반 제목 (§8.1)
  }
}

/**
 * 하루 재조립 (POST /api/moments/assemble)
 * 기존 draft Moment는 파기 후 재생성. confirmed/soft_confirmed는 유지하고
 * 해당 Moment에 배정된 사진은 재조립에서 제외한다.
 */
export async function assembleDay(userId: string, date: string): Promise<{ moments: number; questions: number }> {
  const { start, end } = kstDayRange(date);

  // 확정된 Moment의 사진은 건드리지 않는다
  const { data: confirmedMoments } = await db().from("moments")
    .select("id").eq("user_id", userId).eq("date", date).neq("status", "draft");
  const confirmedIds = (confirmedMoments ?? []).map((m) => m.id);

  // draft 파기 (사진 moment_id는 FK set null)
  await db().from("moments").delete()
    .eq("user_id", userId).eq("date", date).eq("status", "draft");

  const { data: photoRows } = await db().from("photos")
    .select("id, taken_at, lat, lng, gps_source, storage_mid_path, is_receipt, moment_id")
    .eq("user_id", userId)
    .gte("taken_at", start.toISOString())
    .lt("taken_at", end.toISOString())
    .order("taken_at");

  const photos = ((photoRows ?? []) as (PhotoRow & { moment_id: string | null })[])
    .filter((p) => !p.moment_id || !confirmedIds.includes(p.moment_id));
  if (photos.length === 0) return { moments: 0, questions: 0 };

  interpolateGps(photos);
  // 보간 결과 DB 반영
  for (const p of photos.filter((x) => x.gps_source === "interpolated")) {
    await db().from("photos").update({ lat: p.lat, lng: p.lng, gps_source: "interpolated" }).eq("id", p.id);
  }

  const { data: eventRows } = await db().from("calendar_events_cache")
    .select("id, title, starts_at, ends_at, location_text, loc_lat, loc_lng, attendees")
    .eq("user_id", userId)
    .gte("starts_at", new Date(start.getTime() - 6 * 3600_000).toISOString())
    .lt("starts_at", end.toISOString());
  const events = (eventRows ?? []) as CalEvent[];

  const clusters = clusterPhotos(photos);
  let questionCount = 0;
  // 기존 미답변 질문 수 파악 (하루 최대 3개)
  const { count: existingQ } = await db().from("moment_questions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("answered_at", null);
  questionCount = existingQ ?? 0;

  let seq = confirmedIds.length;
  let created = 0;

  // 클러스터별 컨텍스트 수집 + AI 해석을 병렬 실행 (기존 순차 → 총 소요 = 가장 느린 클러스터 1개 수준)
  const analyses = await Promise.all(clusters.map(async (cluster) => {
    const c = centroid(cluster);
    const mStart = new Date(cluster[0].taken_at);
    const mEnd = new Date(cluster[cluster.length - 1].taken_at);

    // 컨텍스트 수집 (병렬)
    const [address, pois, weather] = await Promise.all([
      c ? coordToAddress(c.lat, c.lng) : Promise.resolve(null),
      c ? nearbyPois(c.lat, c.lng) : Promise.resolve([] as PoiCandidate[]),
      c ? getWeather(c.lat, c.lng, mStart) : Promise.resolve(null),
    ]);

    // 시간대 겹치는 일정 (±90분 창)
    const nearEvents = events.filter((ev) => {
      const es = new Date(ev.starts_at).getTime();
      const ee = ev.ends_at ? new Date(ev.ends_at).getTime() : es + 3600_000;
      return es - 90 * 60000 < mEnd.getTime() && ee + 90 * 60000 > mStart.getTime();
    });

    let ai: Call1Result | null = null;
    try {
      ai = await interpretMoment(userId, cluster, address, pois, nearEvents, weather);
    } catch (e) {
      if (e instanceof AiLimitError) ai = null;
      else throw e;
    }

    return { cluster, c, mStart, mEnd, address, pois, weather, nearEvents, ai };
  }));

  // 저장 단계는 seq/질문 수 카운터의 일관성을 위해 순차 처리
  for (const { cluster, c, mStart, mEnd, address, pois, weather, nearEvents, ai } of analyses) {
    // 장소 확정: LLM place_match > 최근접 POI
    let place: PoiCandidate | null = null;
    const pmIdx = ai?.place_match?.poi_index;
    if (pmIdx != null && pois[pmIdx]) place = pois[pmIdx];
    else if (pois[0] && pois[0].distance <= 80) place = pois[0];

    // 일정 매칭: 휴리스틱 + LLM 5:5 (§8.2)
    let bestEvent: CalEvent | null = null;
    let bestScore = 0;
    let bestBreakdown: Record<string, number> = {};
    for (const ev of nearEvents) {
      const h = heuristicScore(mStart, mEnd, c, ev);
      const llmConf = ai?.event_match?.event_id === ev.id ? (ai.event_match.confidence ?? 0) : 0;
      const heuristic = h.time + h.dist + 0.3 * llmConf;
      const final = 0.5 * heuristic + 0.5 * llmConf;
      if (final > bestScore) {
        bestScore = final;
        bestEvent = ev;
        bestBreakdown = { time: h.time, dist: h.dist, llm: llmConf, heuristic, final };
      }
    }

    const linked = bestEvent && bestScore >= AUTO_LINK;
    const askable = bestEvent && bestScore >= ASK_MIN && bestScore < AUTO_LINK;

    const title =
      ai?.title_candidates?.[0] ??
      (place ? `${place.name}에서` : address ? `${address.split(" ").slice(-1)[0]} 근처에서` : `${kstDayPart(cluster[0].taken_at)}의 기록`);

    const people = linked
      ? (bestEvent!.attendees ?? []).map((a) => ({ name: a.name, source: "calendar" }))
      : [];

    const { data: momentRow } = await db().from("moments").insert({
      user_id: userId,
      date,
      seq: seq++,
      title,
      starts_at: mStart.toISOString(),
      ends_at: mEnd.toISOString(),
      place_name: place?.name ?? null,
      place_category: place?.category ?? null,
      address,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      linked_event_id: linked ? bestEvent!.id : null,
      link_confidence: bestEvent ? Number(bestScore.toFixed(3)) : null,
      people,
      weather: weather ?? null,
      ai: ai ? {
        scene_summary: ai.scene_summary,
        facts: ai.facts ?? [],
        inferences: ai.inferences ?? [],
        ocr_texts: ai.ocr_texts ?? [],
        title_candidates: ai.title_candidates ?? [],
      } : null,
      status: "draft",
    }).select("id").single();

    if (!momentRow) continue;
    created++;
    const momentId = momentRow.id as string;

    // 사진 배정 + 영수증 반영
    await db().from("photos").update({ moment_id: momentId }).in("id", cluster.map((p) => p.id));
    if (ai?.receipt?.store) {
      const receiptPhoto = cluster.find((p) => p.is_receipt) ?? cluster[0];
      await db().from("photos").update({ receipt: ai.receipt, is_receipt: true }).eq("id", receiptPhoto.id);
    }

    // 증거 저장 (설명가능성 — FR-4.2 AC)
    const evidence: Array<Record<string, unknown>> = [
      { moment_id: momentId, type: "photo", payload: { count: cluster.length, scene: ai?.scene_summary ?? null, ocr: ai?.ocr_texts ?? [] } },
    ];
    if (place) evidence.push({ moment_id: momentId, type: "poi", payload: { ...place }, score: ai?.place_match?.confidence ?? null });
    if (bestEvent) evidence.push({
      moment_id: momentId, type: "calendar",
      payload: { event_id: bestEvent.id, title: bestEvent.title, linked: !!linked },
      score: Number(bestScore.toFixed(3)), score_breakdown: bestBreakdown,
    });
    if (weather) evidence.push({ moment_id: momentId, type: "weather", payload: weather as unknown as Record<string, unknown> });
    if (cluster.some((p) => p.gps_source === "interpolated")) {
      evidence.push({ moment_id: momentId, type: "interpolated_gps", payload: { photo_ids: cluster.filter((p) => p.gps_source === "interpolated").map((p) => p.id) } });
    }
    if (ai?.receipt?.store) evidence.push({ moment_id: momentId, type: "receipt", payload: ai.receipt });
    await db().from("moment_evidence").insert(evidence);

    // 버튼 질문 (0.45~0.75 구간, 하루 ≤3 — FR-4.3)
    if (askable && questionCount < MAX_QUESTIONS_PER_DAY) {
      const q = ai?.question_candidates?.find((x) => x.target === "event_link")?.q
        ?? `이 기록, '${bestEvent!.title}' 일정과 관련 있나요?`;
      await db().from("moment_questions").insert({
        moment_id: momentId,
        user_id: userId,
        question_text: q,
        options: ["맞아요", "아니에요"],
        target: "event_link",
        payload: { event_id: bestEvent!.id, score: bestScore },
        confidence_before: Number(bestScore.toFixed(3)),
      });
      questionCount++;
    }
  }

  return { moments: created, questions: questionCount };
}
