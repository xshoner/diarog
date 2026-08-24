import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/session";
import { db } from "@/lib/supabase";
import { coordToAddress } from "@/lib/kakao";

// 내 장소 (user_places): 등록 반경 내 사진은 조립 시 이 이름을 최우선 사용

export async function GET() {
  try {
    const { profile } = await requireUser();
    const { data, error } = await db().from("user_places")
      .select("id, name, lat, lng, radius_m, created_at")
      .eq("user_id", profile.user_id).order("created_at");
    if (error) return Response.json({ error: error.message, code: error.code }, { status: 500 });
    return Response.json({ places: data ?? [] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// POST {name, lat, lng, radius?} — 같은 이름이면 위치 갱신(upsert)
export async function POST(req: Request) {
  try {
    const { profile } = await requireUser();
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: "이름과 좌표가 필요해요" }, { status: 400 });
    }
    const radius = Number.isFinite(Number(body.radius)) ? Math.min(1000, Math.max(50, Number(body.radius))) : 150;

    const { data, error } = await db().from("user_places").upsert({
      user_id: profile.user_id, name, lat, lng, radius_m: radius,
    }, { onConflict: "user_id,name" }).select("id, name, lat, lng, radius_m").single();
    if (error || !data) {
      // 42P01 = 테이블 없음 (0002 마이그레이션 미실행)
      const msg = error?.code === "42P01"
        ? "내 장소 저장소가 아직 준비되지 않았어요 (0002 마이그레이션 필요)"
        : error?.message;
      return Response.json({ error: msg }, { status: 500 });
    }
    const address = await coordToAddress(lat, lng).catch(() => null);
    await db().from("analytics_events").insert({ user_id: profile.user_id, name: "place_registered" });
    return Response.json({ place: data, address });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
