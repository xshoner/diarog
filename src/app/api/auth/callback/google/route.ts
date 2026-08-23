import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, decodeIdToken, SCOPE_CALENDAR } from "@/lib/google";
import { db, ensurePhotoBucket } from "@/lib/supabase";
import { createSession, getSession } from "@/lib/session";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("oauth_state")?.value;
  const fail = (reason: string) =>
    NextResponse.redirect(`${env.appUrl()}/onboarding?error=${encodeURIComponent(reason)}`);

  if (!code || !state || state !== cookieState) return fail("auth_state");

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.id_token) return fail("no_id_token");
    const g = decodeIdToken(tokens.id_token);

    // 사용자 upsert
    const { data: existing } = await db().from("users_profile")
      .select("user_id, onboarded").eq("google_sub", g.sub).maybeSingle();

    let userId: string;
    let onboarded = false;
    if (existing) {
      userId = existing.user_id;
      onboarded = existing.onboarded;
      await db().from("users_profile").update({
        email: g.email, display_name: g.name, avatar_url: g.picture,
      }).eq("user_id", userId);
    } else {
      const { data: created, error } = await db().from("users_profile").insert({
        google_sub: g.sub, email: g.email, display_name: g.name, avatar_url: g.picture,
      }).select("user_id").single();
      if (error || !created) return fail("signup_failed");
      userId = created.user_id;
      await db().from("analytics_events").insert({ user_id: userId, name: "signup" });
    }

    // 캘린더 스코프 승인 여부 (Progressive Permission 2단계)
    const calendarGranted = (tokens.scope ?? "").includes(SCOPE_CALENDAR);
    if (calendarGranted && tokens.refresh_token) {
      await db().from("users_profile").update({
        calendar_connected: true,
        google_refresh_token: tokens.refresh_token,
      }).eq("user_id", userId);
      await db().from("analytics_events").insert({ user_id: userId, name: "calendar_connected" });
    }

    // 기존 세션 사용자가 캘린더만 추가 연동한 경우 세션 유지
    const session = await getSession();
    if (!session || session.userId !== userId) {
      await createSession({ userId, email: g.email, name: g.name });
    }

    await ensurePhotoBucket().catch(() => {});

    const dest = state.endsWith(".cal")
      ? "/onboarding?step=push"
      : onboarded ? "/" : "/onboarding?step=persona";
    const res = NextResponse.redirect(`${env.appUrl()}${dest}`);
    res.cookies.delete("oauth_state");
    return res;
  } catch {
    return fail("exchange_failed");
  }
}
