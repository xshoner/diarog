import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import { db } from "./supabase";

const COOKIE = "diarog_session";
const MAX_AGE = 60 * 60 * 24 * 90; // 90일

export interface SessionUser {
  userId: string;
  email?: string;
  name?: string;
}

function secret() {
  return new TextEncoder().encode(env.authSecret());
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** 세션 검증 — 미로그인 시 null */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    };
  } catch {
    return null;
  }
}

/** 세션 + 프로필 로드. 미로그인 시 401 응답을 던진다. */
export async function requireUser() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  const { data: profile } = await db()
    .from("users_profile")
    .select("*")
    .eq("user_id", session.userId)
    .single();
  if (!profile) throw new UnauthorizedError();
  return { session, profile };
}

export class UnauthorizedError extends Error {
  constructor() { super("unauthorized"); }
}

export function unauthorizedResponse() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
