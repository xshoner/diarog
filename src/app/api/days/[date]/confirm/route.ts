import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";
import { generateDiary, indexMoments } from "@/lib/diary";

export const maxDuration = 300;

// POST /api/days/:date/confirm — 하루 확정 → Call-2 일기 생성 (§5.3-5)
export async function POST(req: Request, ctx: { params: Promise<{ date: string }> }) {
  try {
    const { profile } = await requireUser();
    const { date } = await ctx.params;
    const userId = profile.user_id;
    const body = await req.json().catch(() => ({}));
    const startedAt = Date.now();

    // draft → confirmed
    const { data: drafts } = await db().from("moments")
      .select("id").eq("user_id", userId).eq("date", date).eq("status", "draft");
    if (drafts?.length) {
      await db().from("moments").update({
        status: "confirmed", confirmed_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("date", date).eq("status", "draft");
    }

    const { count: confirmedCount } = await db().from("moments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("date", date).in("status", ["confirmed", "soft_confirmed"]);
    if (!confirmedCount) return Response.json({ error: "no moments" }, { status: 400 });

    // Call-2 일기 생성
    const diary = await generateDiary(userId, date);
    await db().from("diary_entries").upsert({
      user_id: userId,
      date,
      body_generated: diary.body,
      body_final: diary.body,
      sentences: diary.sentences,
      one_line: diary.oneLine,
      persona_type_used: diary.personaType,
      few_shot_count: diary.fewShotCount,
      edited: false,
    }, { onConflict: "user_id,date" });

    // 검색 인덱스 (비동기 실패 허용)
    await indexMoments(userId, date).catch(() => {});

    await db().from("analytics_events").insert({
      user_id: userId,
      name: "day_confirmed",
      props: {
        moment_count: confirmedCount,
        edit_count: body.editCount ?? 0,
        duration_ms: body.sessionMs ?? null,
        zero_entry: body.zeroEntry ?? null,
        gen_ms: Date.now() - startedAt,
      },
    });

    return Response.json({
      ok: true,
      diary: { sentences: diary.sentences, oneLine: diary.oneLine, body: diary.body },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
