import { db } from "./supabase";
import { chatJSON, ChatMessage, embed } from "./letsur";
import { personaSystemPrompt } from "./personas";
import { kstTime } from "./time";
import { weatherText, Weather } from "./kma";

// Call-2: 하루 일기 생성 (§8.3) + 검색 인덱스 갱신

export interface DiarySentence {
  text: string;
  evidence_refs: string[];
  kind: "fact" | "inference";
}

interface Call2Result {
  diary: Array<{ sentence: string; evidence_refs?: string[]; kind?: string }>;
  one_line?: string;
}

interface MomentRow {
  id: string;
  title: string | null;
  starts_at: string | null;
  place_name: string | null;
  address: string | null;
  people: Array<{ name: string; source: string }>;
  mood: string | null;
  memo: string | null;
  weather: Weather | null;
  ai: { facts?: string[]; inferences?: Array<{ text: string }>; scene_summary?: string } | null;
  linked_event_id: string | null;
}

export async function generateDiary(userId: string, date: string): Promise<{ sentences: DiarySentence[]; oneLine: string; body: string; fewShotCount: number; personaType: string }> {
  const { data: profile } = await db().from("users_profile")
    .select("persona_type").eq("user_id", userId).single();
  const personaType = profile?.persona_type ?? "plain";

  const { data: momentRows } = await db().from("moments")
    .select("id, title, starts_at, place_name, address, people, mood, memo, weather, ai, linked_event_id")
    .eq("user_id", userId).eq("date", date)
    .in("status", ["confirmed", "soft_confirmed"])
    .order("starts_at");
  const moments = (momentRows ?? []) as unknown as MomentRow[];
  if (moments.length === 0) throw new Error("no confirmed moments");

  // 연결 일정 제목
  const eventIds = moments.map((m) => m.linked_event_id).filter(Boolean) as string[];
  const eventTitles: Record<string, string> = {};
  if (eventIds.length) {
    const { data: evs } = await db().from("calendar_events_cache").select("id, title").in("id", eventIds);
    for (const e of evs ?? []) eventTitles[e.id] = e.title;
  }

  // 페르소나 2층: 최근 수정 쌍 few-shot (FR-5.4) — 시간이 지날수록 사용자 문체에 수렴
  const { data: edits } = await db().from("persona_edits")
    .select("original, revised").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(20);
  const fewShot = edits ?? [];

  // 사용자가 직접 다듬어 완성한 최근 일기 — 가장 강한 문체 신호
  const { data: recentEdited } = await db().from("diary_entries")
    .select("body_final").eq("user_id", userId).eq("edited", true)
    .neq("date", date)
    .order("date", { ascending: false }).limit(2);
  const styleExemplars = (recentEdited ?? [])
    .map((d) => d.body_final as string | null)
    .filter((b): b is string => !!b);

  const momentsCtx = moments.map((m, i) => ({
    momentId: m.id,
    순번: i + 1,
    시각: m.starts_at ? kstTime(m.starts_at) : null,
    제목: m.title,
    장소: m.place_name ?? m.address,
    일정: m.linked_event_id ? eventTitles[m.linked_event_id] ?? null : null,
    함께한사람: (m.people ?? []).map((p) => p.name),
    기분: m.mood,
    메모: m.memo,
    사실: m.ai?.facts ?? [],
    추정: (m.ai?.inferences ?? []).map((x) => x.text),
    장면: m.ai?.scene_summary ?? null,
    날씨: weatherText(m.weather),
  }));

  const system = [
    personaSystemPrompt(personaType),
    "",
    "작업: 아래 확정된 Moment들로 오늘 하루의 일기를 5~10문장으로 쓴다.",
    "각 문장에는 근거가 된 momentId와 증거 유형(photo|calendar|poi|weather|user)을 evidence_refs로 표기한다 (형식: \"momentId:type\").",
    "사실 기반 문장은 kind=fact, 추정이 섞인 문장은 kind=inference로 구분한다.",
    fewShot.length > 0 ? [
      "",
      "사용자의 문체 교정 이력 (원문 → 사용자가 고친 문장). 수정 방향에서 어미·문장 길이·어투·자주 쓰는 표현을 파악해,",
      "고쳐질 문장을 쓰지 말고 처음부터 사용자가 고친 쪽의 문체로 써라:",
      ...fewShot.map((e) => `- 원문: ${e.original}\n  수정: ${e.revised}`),
    ].join("\n") : "",
    styleExemplars.length > 0 ? [
      "",
      "사용자가 직접 다듬어 완성한 최근 일기 전문 (문체의 최우선 기준 — 어미, 리듬, 어휘를 이 글에 맞출 것):",
      ...styleExemplars.map((b, i) => `[예시 ${i + 1}] ${b.slice(0, 500)}`),
    ].join("\n") : "",
    "",
    "one_line 규칙: 본문 요약의 반복이 아니라, 오늘 하루를 재치 있게 압축한 한줄평 한 문장 (25자 내외).",
    "예: '회의 3연타를 버텨낸 커피 두 잔의 날' 같은 느낌. 근거 없는 사건은 넣지 않는다.",
    "",
    "반드시 아래 JSON으로만 응답:",
    JSON.stringify({
      diary: [{ sentence: "string", evidence_refs: ["momentId:photo"], kind: "fact|inference" }],
      one_line: "오늘의 한줄평 (위트 있게, 25자 내외)",
    }),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: `오늘(${date})의 확정 Moment:\n${JSON.stringify(momentsCtx, null, 1)}` },
  ];

  const result = await chatJSON<Call2Result>(messages, { userId, kind: "call2", maxTokens: 6000, temperature: 0.7 });

  const sentences: DiarySentence[] = (result.diary ?? [])
    .filter((s) => s.sentence?.trim())
    .map((s) => ({
      text: s.sentence.trim(),
      evidence_refs: s.evidence_refs ?? [],
      kind: s.kind === "inference" ? "inference" : "fact",
    }));
  if (sentences.length === 0) throw new Error("empty diary");

  const body = sentences.map((s) => s.text).join(" ");
  const oneLine = result.one_line?.trim() || sentences[0].text;

  return { sentences, oneLine, body, fewShotCount: fewShot.length, personaType };
}

/** 확정된 Moment들의 검색 인덱스 생성 (FR-8.1) */
export async function indexMoments(userId: string, date: string): Promise<void> {
  const { data: momentRows } = await db().from("moments")
    .select("id, title, place_name, address, people, memo, mood, ai")
    .eq("user_id", userId).eq("date", date)
    .in("status", ["confirmed", "soft_confirmed"]);
  for (const m of (momentRows ?? []) as unknown as MomentRow[]) {
    const summary = [
      m.title,
      m.place_name,
      m.address,
      (m.people ?? []).map((p) => p.name).join(" "),
      m.memo,
      m.mood,
      ...(m.ai?.facts ?? []),
    ].filter(Boolean).join(" · ");
    try {
      const vec = await embed(`${date} ${summary}`, userId);
      await db().from("search_index").upsert({
        moment_id: m.id,
        user_id: userId,
        date,
        summary,
        embedding: JSON.stringify(vec),
        updated_at: new Date().toISOString(),
      });
    } catch {
      // 임베딩 실패 시 요약 텍스트만 저장 (키워드 검색 폴백)
      await db().from("search_index").upsert({
        moment_id: m.id, user_id: userId, date, summary, updated_at: new Date().toISOString(),
      });
    }
  }
}
