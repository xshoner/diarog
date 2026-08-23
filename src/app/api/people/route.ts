import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";

// GET /api/people — 만남 기록: 인물별 집계 (FR-9.1)
export async function GET() {
  try {
    const { profile } = await requireUser();
    const { data: moments } = await db().from("moments")
      .select("id, date, title, place_name, people")
      .eq("user_id", profile.user_id)
      .in("status", ["confirmed", "soft_confirmed"])
      .order("date", { ascending: false })
      .limit(500);

    const byPerson: Record<string, { name: string; count: number; lastDate: string; lastTitle: string | null; places: Set<string> }> = {};
    for (const m of moments ?? []) {
      for (const p of (m.people ?? []) as Array<{ name: string }>) {
        if (!p.name) continue;
        if (!byPerson[p.name]) {
          byPerson[p.name] = { name: p.name, count: 0, lastDate: m.date, lastTitle: m.title, places: new Set() };
        }
        const e = byPerson[p.name];
        e.count++;
        if (m.date > e.lastDate) { e.lastDate = m.date; e.lastTitle = m.title; }
        if (m.place_name) e.places.add(m.place_name);
      }
    }
    const people = Object.values(byPerson)
      .map((p) => ({ ...p, places: [...p.places].slice(0, 5) }))
      .sort((a, b) => b.count - a.count);
    return Response.json({ people });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
