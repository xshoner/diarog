import { env } from "./env";
import { db } from "./supabase";
import { geocodeText } from "./kakao";

// Google OAuth (로그인 + Progressive Permission으로 calendar.readonly 증분 요청)

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE_BASE = "openid email profile";
export const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";

export function redirectUri(): string {
  return `${env.appUrl()}/api/auth/callback/google`;
}

export function buildAuthUrl(opts: { calendar?: boolean; state: string }): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: opts.calendar ? `${SCOPE_BASE} ${SCOPE_CALENDAR}` : SCOPE_BASE,
    access_type: opts.calendar ? "offline" : "online",
    include_granted_scopes: "true",
    state: opts.state,
    ...(opts.calendar ? { prompt: "consent" } : {}),
  });
  return `${AUTH_URL}?${params}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.access_token ?? null;
}

/** id_token 페이로드 디코딩 (서버가 구글에서 직접 받은 토큰이므로 서명 재검증 생략 가능) */
export function decodeIdToken(idToken: string): { sub: string; email?: string; name?: string; picture?: string } {
  const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
}

interface GcalEvent {
  id: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>;
}

/**
 * 캘린더 동기화: 최근 7일 + 향후 1일 (FR-1.3). description 미수집.
 * 일정 장소 문자열은 카카오 지오코딩으로 좌표 캐시(거리 점수용).
 */
export async function syncCalendar(userId: string): Promise<{ ok: boolean; count: number }> {
  const { data: profile } = await db().from("users_profile")
    .select("google_refresh_token").eq("user_id", userId).single();
  const rt = profile?.google_refresh_token;
  if (!rt) return { ok: false, count: 0 };
  const accessToken = await refreshAccessToken(rt);
  if (!accessToken) {
    await db().from("users_profile").update({ calendar_connected: false }).eq("user_id", userId);
    return { ok: false, count: 0 };
  }
  const timeMin = new Date(Date.now() - 7 * 86400_000).toISOString();
  const timeMax = new Date(Date.now() + 1 * 86400_000).toISOString();
  const qs = new URLSearchParams({
    timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100",
    fields: "items(id,summary,location,start,end,attendees(email,displayName,self))",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { ok: false, count: 0 };
  const json = await res.json();
  const events: GcalEvent[] = json.items ?? [];
  let count = 0;
  for (const ev of events) {
    const starts = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00+09:00` : null);
    const ends = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00+09:00` : null);
    if (!starts) continue;
    const attendees = (ev.attendees ?? [])
      .filter((a) => !a.self)
      .slice(0, 10)
      .map((a) => ({ name: a.displayName || (a.email ? a.email.split("@")[0] : "?"), email: a.email }));
    // 기존 행 확인 → 장소 좌표는 최초 1회만 지오코딩
    const { data: existing } = await db().from("calendar_events_cache")
      .select("id, location_text, loc_lat").eq("user_id", userId).eq("gcal_event_id", ev.id).maybeSingle();
    let geo: { lat: number; lng: number } | null = null;
    if (ev.location && (!existing || existing.location_text !== ev.location || existing.loc_lat == null)) {
      geo = await geocodeText(ev.location);
    }
    const row: Record<string, unknown> = {
      user_id: userId,
      gcal_event_id: ev.id,
      title: ev.summary ?? "(제목 없음)",
      starts_at: starts,
      ends_at: ends,
      location_text: ev.location ?? null,
      attendees,
      synced_at: new Date().toISOString(),
    };
    if (geo) { row.loc_lat = geo.lat; row.loc_lng = geo.lng; }
    await db().from("calendar_events_cache").upsert(row, { onConflict: "user_id,gcal_event_id" });
    count++;
  }
  return { ok: true, count };
}
