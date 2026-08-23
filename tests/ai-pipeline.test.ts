// AI 파이프라인 라이브 테스트: Call-1(사건 해석) / Call-2(페르소나 일기) JSON 스키마 검증
// 실행: npx tsx tests/ai-pipeline.test.ts (LETSUR_API_KEY 필요)
import { chatJSON, ChatMessage } from "../src/lib/letsur";
import { personaSystemPrompt } from "../src/lib/personas";

process.env.LETSUR_API_KEY = process.env.LETSUR_API_KEY || "sk-MMKbCTiXLaB9bEpKmyLZAw";
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://okrecbetvcdglnjlprqj.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`, JSON.stringify(extra)?.slice(0, 300) ?? ""); }
}

// 1x1 픽셀 대신 실제 장면이 있는 작은 테스트 이미지 (단색 그라데이션 음식 느낌은 불가 — 단색으로 스키마 검증만)
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Call1 {
  scene_summary?: string;
  title_candidates?: string[];
  event_match?: { event_id?: string | null; confidence?: number };
  facts?: string[];
  question_candidates?: Array<{ q: string }>;
}

interface Call2 {
  diary: Array<{ sentence: string; evidence_refs?: string[]; kind?: string }>;
  one_line?: string;
}

(async () => {
  // Call-1 스키마 검증
  const call1System = [
    "너는 증거 기반 사건 해석기다. 사진과 컨텍스트에서 확인 가능한 것만 사실로 기술하고, 확인 불가한 것은 추정으로 분리한다.",
    "반드시 아래 JSON 스키마로만 응답한다:",
    JSON.stringify({
      scene_summary: "string", ocr_texts: [], title_candidates: ["string"],
      place_match: { poi_index: 0, confidence: 0 },
      event_match: { event_id: "string|null", confidence: 0, reason: "string" },
      facts: [], inferences: [], question_candidates: [], receipt: null,
    }),
  ].join("\n");
  const ctx = {
    촬영시각: ["12:10", "12:45"], 시간대: "점심", 주소: "서울 성동구 성수동2가",
    장소후보: [{ index: 0, 이름: "테스트파스타", 카테고리: "이탈리안", 거리m: 25 }],
    일정후보: [{ event_id: "ev_123", 제목: "김대리 점심", 시작: "12:00", 종료: "13:00", 장소: "성수동", 참석자: ["김대리"] }],
    날씨: { 기온: 24, 강수: null },
  };
  try {
    const r1 = await chatJSON<Call1>([
      { role: "system", content: call1System },
      {
        role: "user", content: [
          { type: "text", text: `컨텍스트:\n${JSON.stringify(ctx)}\n\n사진을 분석하고 JSON으로 응답하라.` },
          { type: "image_url", image_url: { url: TINY_PNG } },
        ],
      },
    ] as ChatMessage[], { kind: "call1", maxTokens: 5000 });
    check("Call-1 JSON 파싱", typeof r1 === "object");
    check("Call-1 title_candidates", Array.isArray(r1.title_candidates) && r1.title_candidates.length > 0, r1.title_candidates);
    check("Call-1 event_match 존재", r1.event_match !== undefined, r1.event_match);
    console.log("   제목 후보:", r1.title_candidates?.[0], "| event:", r1.event_match?.event_id, r1.event_match?.confidence);
  } catch (e) {
    check("Call-1 호출", false, String(e));
  }

  // Call-2 스키마 검증 (페르소나 일기)
  const call2System = [
    personaSystemPrompt("essay"),
    "",
    "작업: 아래 확정된 Moment들로 오늘 하루의 일기를 5~10문장으로 쓴다.",
    "각 문장에는 근거가 된 momentId와 증거 유형을 evidence_refs로 표기한다 (형식: \"momentId:type\").",
    "사실 기반 문장은 kind=fact, 추정이 섞인 문장은 kind=inference로 구분한다.",
    "반드시 아래 JSON으로만 응답:",
    JSON.stringify({ diary: [{ sentence: "string", evidence_refs: ["m1:photo"], kind: "fact|inference" }], one_line: "string" }),
  ].join("\n");
  const momentsCtx = [
    { momentId: "m1", 순번: 1, 시각: "12:10", 제목: "성수동 파스타집에서 점심", 장소: "테스트파스타", 일정: "김대리 점심", 함께한사람: ["김대리"], 사실: ["파스타를 먹었다"], 추정: [], 날씨: "24℃" },
    { momentId: "m2", 순번: 2, 시각: "19:30", 제목: "한강 산책", 장소: "뚝섬한강공원", 일정: null, 함께한사람: [], 사실: ["노을 사진 3장"], 추정: ["혼자 산책한 듯"], 날씨: null },
  ];
  try {
    const r2 = await chatJSON<Call2>([
      { role: "system", content: call2System },
      { role: "user", content: `오늘(2026-08-23)의 확정 Moment:\n${JSON.stringify(momentsCtx)}` },
    ], { kind: "call2", maxTokens: 6000, temperature: 0.7 });
    check("Call-2 diary 배열", Array.isArray(r2.diary) && r2.diary.length >= 3, r2.diary?.length);
    check("Call-2 evidence_refs", r2.diary.every((s) => Array.isArray(s.evidence_refs)), r2.diary?.[0]);
    check("Call-2 kind 구분", r2.diary.some((s) => s.kind === "fact"));
    check("Call-2 one_line", typeof r2.one_line === "string" && r2.one_line.length > 0, r2.one_line);
    console.log("   일기 첫 문장:", r2.diary[0]?.sentence);
    console.log("   한 줄:", r2.one_line);
  } catch (e) {
    check("Call-2 호출", false, String(e));
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail > 0 ? 1 : 0);
})();
