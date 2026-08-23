import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const calendar = req.nextUrl.searchParams.get("calendar") === "1";
  const state = crypto.randomBytes(16).toString("hex") + (calendar ? ".cal" : "");
  const res = NextResponse.redirect(buildAuthUrl({ calendar, state }));
  res.cookies.set("oauth_state", state, {
    httpOnly: true, sameSite: "lax", maxAge: 600, path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
