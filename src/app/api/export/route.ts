import JSZip from "jszip";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db, PHOTO_BUCKET } from "@/lib/supabase";

export const maxDuration = 300;

// POST /api/export — 전체 내보내기: 일기 MD + Moment JSON + 썸네일 zip (FR-10.2)
export async function POST() {
  try {
    const { profile } = await requireUser();
    const userId = profile.user_id;
    const zip = new JSZip();

    const [{ data: diaries }, { data: moments }, { data: photos }] = await Promise.all([
      db().from("diary_entries").select("date, body_final, one_line, sentences").eq("user_id", userId).order("date"),
      db().from("moments").select("*").eq("user_id", userId).order("date"),
      db().from("photos").select("id, taken_at, moment_id, storage_thumb_path").eq("user_id", userId).order("taken_at"),
    ]);

    // 일기 Markdown
    const md = (diaries ?? []).map((d) =>
      `## ${d.date}\n\n> ${d.one_line ?? ""}\n\n${d.body_final ?? ""}\n`).join("\n---\n\n");
    zip.file("diary.md", `# 나의 라이프로그\n\n${md}`);
    zip.file("moments.json", JSON.stringify(moments ?? [], null, 2));

    // 썸네일 (최대 500장)
    const thumbFolder = zip.folder("thumbnails");
    for (const p of (photos ?? []).slice(0, 500)) {
      try {
        const { data } = await db().storage.from(PHOTO_BUCKET).download(p.storage_thumb_path);
        if (data) {
          thumbFolder?.file(`${p.taken_at.slice(0, 10)}_${p.id.slice(0, 8)}.jpg`, await data.arrayBuffer());
        }
      } catch { /* skip */ }
    }

    const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    await db().from("analytics_events").insert({ user_id: userId, name: "export_requested" });

    return new Response(Buffer.from(blob), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="diarog-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
