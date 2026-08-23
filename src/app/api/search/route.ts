import { NextRequest } from "next/server";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, signPaths } from "@/lib/supabase";
import { chatJSON, embed, ChatMessage } from "@/lib/letsur";
import { kstDateString, addDays } from "@/lib/time";

export const maxDuration = 60;

// GET /api/search?q= — 자연어 기억 검색 (FR-8) — 무료 30일 경계 서버 강제 (FR-8.2)
const FREE_DAYS = 30;

interface Call4Result {
  date_from?: string | null;
  date_to?: string | null;
  place_terms?: string[];
  people_terms?: string[];
  free_text?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return Response.json({ error: "empty query" }, { status: 400 });

    const today = kstDateString();
    const freeFrom = profile.plan === "free" ? addDays(today, -FREE_DAYS) : null;

    // Call-4: 쿼리 파라미터 추출 (실패해도 임베딩 검색은 진행)
    let parsed: Call4Result = {};
    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `오늘은 ${today}다. 사용자의 기억 검색어에서 검색 파라미터를 추출한다. 반드시 JSON으로만 응답: ` +
            JSON.stringify({ date_from: "YYYY-MM-DD|null", date_to: "YYYY-MM-DD|null", place_terms: ["장소"], people_terms: ["인물"], free_text: "나머지 의미" }),
        },
        { role: "user", content: q },
      ];
      parsed = await chatJSON<Call4Result>(messages, { userId, kind: "call4", maxTokens: 2000, temperature: 0 });
    } catch { /* 폴백: 전체 텍스트 임베딩 */ }

    // 임베딩 검색 (구조 필터 병행)
    const vec = await embed(q, userId);
    const from = [parsed.date_from, freeFrom].filter(Boolean).sort().reverse()[0] ?? null; // 더 좁은 쪽
    const { data: matches } = await db().rpc("match_moments", {
      p_user_id: userId,
      p_embedding: JSON.stringify(vec),
      p_from: from,
      p_to: parsed.date_to ?? null,
      p_limit: 20,
    });

    // 잠금 카드: 무료 경계 밖 기록 수 (§10 전환 넛지)
    let lockedCount = 0;
    if (freeFrom) {
      const { count } = await db().from("moments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).lt("date", freeFrom)
        .in("status", ["confirmed", "soft_confirmed"]);
      lockedCount = count ?? 0;
    }

    const ids = ((matches ?? []) as Array<{ moment_id: string; similarity: number }>).map((m) => m.moment_id);
    let results: Array<Record<string, unknown>> = [];
    if (ids.length) {
      const { data: moments } = await db().from("moments")
        .select("id, date, title, place_name, address, people, mood")
        .in("id", ids);
      const { data: photos } = await db().from("photos")
        .select("moment_id, storage_thumb_path").in("moment_id", ids);
      const thumbByMoment: Record<string, string> = {};
      for (const p of photos ?? []) {
        if (!thumbByMoment[p.moment_id]) thumbByMoment[p.moment_id] = p.storage_thumb_path;
      }
      const signed = await signPaths(Object.values(thumbByMoment));
      const simById: Record<string, number> = {};
      for (const m of (matches ?? []) as Array<{ moment_id: string; similarity: number }>) simById[m.moment_id] = m.similarity;

      // 구조 필터 가점: 장소/인물 텍스트 일치
      results = (moments ?? []).map((m) => {
        let boost = 0;
        const placeText = `${m.place_name ?? ""} ${m.address ?? ""}`;
        for (const t of parsed.place_terms ?? []) if (t && placeText.includes(t)) boost += 0.1;
        const peopleText = ((m.people ?? []) as Array<{ name: string }>).map((p) => p.name).join(" ");
        for (const t of parsed.people_terms ?? []) if (t && peopleText.includes(t)) boost += 0.15;
        return {
          ...m,
          thumbUrl: thumbByMoment[m.id] ? signed[thumbByMoment[m.id]] ?? null : null,
          score: (simById[m.id] ?? 0) + boost,
        };
      }).sort((a, b) => (b.score as number) - (a.score as number));
    }

    await db().from("analytics_events").insert({
      user_id: userId, name: "search_performed",
      props: { q_len: q.length, results: results.length, range_hit_lock: lockedCount > 0 },
    });

    return Response.json({ results, lockedCount, freeBoundary: freeFrom });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
