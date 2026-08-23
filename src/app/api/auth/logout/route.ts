import { destroySession } from "@/lib/session";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  await destroySession();
  return NextResponse.redirect(`${env.appUrl()}/onboarding`);
}
