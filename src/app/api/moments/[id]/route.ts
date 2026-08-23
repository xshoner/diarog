import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// PATCH /api/moments/:id — 인라인 편집 (제목/장소/일정연결/사람/기분/메모/사진제외)
// 모든 수정은 corrections에 기록 (FR-4.5, MOAT 데이터)
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUser();
    const { id } = await ctx.params;
    const userId = profile.user_id;
    const body = await req.json();

    const { data: moment } = await db().from("moments")
      .select("*").eq("id", id).eq("user_id", userId).single();
    if (!moment) return Response.json({ error: "not found" }, { status: 404 });

    const update: Record<string, unknown> = {};
    const corrections: Array<Record<string, unknown>> = [];
    const record = (kind: string, before: unknown, after: unknown) =>
      corrections.push({ user_id: userId, moment_id: id, kind, before: { v: before }, after: { v: after } });

    if (typeof body.title === "string" && body.title !== moment.title) {
      update.title = body.title.slice(0, 100);
      record("title", moment.title, body.title);
      // 제목 수정도 페르소나 학습 데이터 (persona_edits)
      if (moment.title) {
        await db().from("persona_edits").insert({
          user_id: userId, source: "moment_title", original: moment.title, revised: body.title.slice(0, 100),
        });
      }
    }
    if (typeof body.placeName === "string" && body.placeName !== moment.place_name) {
      update.place_name = body.placeName.slice(0, 100);
      record("place", moment.place_name, body.placeName);
    }
    if (body.linkedEventId !== undefined && body.linkedEventId !== moment.linked_event_id) {
      update.linked_event_id = body.linkedEventId;
      update.link_confidence = body.linkedEventId ? 1 : null; // 사용자 확인 = 확신도 1
      record("event_link", moment.linked_event_id, body.linkedEventId);
    }
    if (Array.isArray(body.people)) {
      update.people = body.people.slice(0, 20).map((p: { name: string; source?: string }) => ({
        name: String(p.name).slice(0, 50), source: p.source === "calendar" ? "calendar" : "user",
      }));
      record("people", moment.people, update.people);
    }
    if (body.mood !== undefined && body.mood !== moment.mood) {
      update.mood = body.mood ? String(body.mood).slice(0, 20) : null;
      record("mood", moment.mood, body.mood);
    }
    if (body.memo !== undefined && body.memo !== moment.memo) {
      update.memo = body.memo ? String(body.memo).slice(0, 500) : null;
      record("memo", moment.memo, body.memo);
    }
    if (Array.isArray(body.removePhotoIds) && body.removePhotoIds.length) {
      await db().from("photos").update({ moment_id: null })
        .eq("user_id", userId).eq("moment_id", id).in("id", body.removePhotoIds);
      record("photo_remove", null, body.removePhotoIds);
    }

    if (Object.keys(update).length) {
      await db().from("moments").update(update).eq("id", id).eq("user_id", userId);
    }
    if (corrections.length) {
      await db().from("corrections").insert(corrections);
      await db().from("analytics_events").insert(
        corrections.map((c) => ({ user_id: userId, name: "moment_edited", props: { kind: c.kind } })));
    }
    const { data: updated } = await db().from("moments").select("*").eq("id", id).single();
    return Response.json({ moment: updated, edited: corrections.length });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/moments/:id — Moment 삭제 (파생 데이터 동반 삭제, FR-10.1)
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUser();
    const { id } = await ctx.params;
    // evidence/questions/search_index는 FK cascade, 사진은 배정 해제
    const { error } = await db().from("moments").delete()
      .eq("id", id).eq("user_id", profile.user_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
