import { authResponseSchema, verifyOtpSchema } from "@habeshalive/shared";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { SESSION_COOKIE } from "@/lib/session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches typical JWT session length

export async function POST(req: Request) {
  const body = verifyOtpSchema.parse(await req.json());

  // Route Handler — runs server-side, needs API_INTERNAL_URL (see config.ts).
  const res = await fetch(`${API_INTERNAL_URL}/auth/verify-otp`, {
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
