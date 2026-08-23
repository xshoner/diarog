import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// POST /api/questions/:id/answer {answer} — 버튼 질문 응답 → 확신도 재계산 (FR-4.3)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUser();
    const { id } = await ctx.params;
    const userId = profile.user_id;
    const { answer } = await req.json();
    if (typeof answer !== "string") return Response.json({ error: "bad request" }, { status: 400 });

    const { data: q } = await db().from("moment_questions")
      .select("*").eq("id", id).eq("user_id", userId).single();
    if (!q) return Response.json({ error: "not found" }, { status: 404 });
    if (q.answered_at) return Response.json({ error: "already answered" }, { status: 409 });

    await db().from("moment_questions").update({
      answer: answer.slice(0, 200),
      answered_at: new Date().toISOString(),
    }).eq("id", id);

    // 확신도 재계산: 사용자 확인은 최종 판정
    let changed = false;
    if (q.target === "event_link" && q.payload?.event_id) {
      if (answer === "맞아요") {
        await db().from("moments").update({
          linked_event_id: q.payload.event_id, link_confidence: 1,
        }).eq("id", q.moment_id).eq("user_id", userId);
        // 참석자를 people 후보로 반영 (FR-4.4)
        const { data: ev } = await db().from("calendar_events_cache")
          .select("attendees").eq("id", q.payload.event_id).single();
        if (ev?.attendees?.length) {
          await db().from("moments").update({
            people: (ev.attendees as Array<{ name: string }>).map((a) => ({ name: a.name, source: "calendar" })),
          }).eq("id", q.moment_id);
        }
        changed = true;
      } else if (answer === "아니에요") {
        await db().from("moments").update({ linked_event_id: null, link_confidence: 0 })
          .eq("id", q.moment_id).eq("user_id", userId);
        changed = true;
      }
    }

    await db().from("moment_evidence").insert({
      moment_id: q.moment_id, type: "user_answer",
      payload: { question: q.question_text, answer, target: q.target },
      score: answer === "맞아요" ? 1 : 0,
    });
    await db().from("corrections").insert({
      user_id: userId, moment_id: q.moment_id, kind: "question_answer",
      before: { confidence: q.confidence_before }, after: { answer },
    });
    await db().from("analytics_events").insert({
      user_id: userId, name: "question_answered", props: { target: q.target, changed },
    });
    return Response.json({ ok: true, changed });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
