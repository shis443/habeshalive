import { authResponseSchema, loginSchema, verifyEmailOtpSchema, verifyOtpSchema } from "@habeshalive/shared";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { SESSION_COOKIE } from "@/lib/session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches typical JWT session length

export async function POST(req: Request) {
  const rawBody = await req.json();
  // Three request shapes share this one endpoint — password login
  // (identifier field, checked first since it's the default returning-user
  // path), phone OTP (phoneNumber field), and email OTP (email field) —
  // routed to their matching upstream API endpoint based on which one the
  // body actually has.
  const isLogin = typeof rawBody === "object" && rawBody !== null && "identifier" in rawBody;
  const isEmail = !isLogin && typeof rawBody === "object" && rawBody !== null && "email" in rawBody;
  const body = isLogin
    ? loginSchema.parse(rawBody)
    : isEmail
      ? verifyEmailOtpSchema.parse(rawBody)
      : verifyOtpSchema.parse(rawBody);
  const upstreamPath = isLogin ? "/auth/login" : isEmail ? "/auth/verify-email-otp" : "/auth/verify-otp";

  // Route Handler — runs server-side, needs API_INTERNAL_URL (see config.ts).
  const res = await fetch(`${API_INTERNAL_URL}${upstreamPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const { token, user } = authResponseSchema.parse(data);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return NextResponse.json({ user });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
