import { authResponseSchema, loginSchema, verifyEmailOtpSchema, verifyOtpSchema } from "@habeshalive/shared";
import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { clearSessionCookie, getSessionCookie, MAX_ACCOUNTS, writeSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
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

  // E.2: ?addAccount=true means "append to whoever's already signed in"
  // (the account switcher's "Add another account" entry point) — anything
  // else is a normal login, which replaces the whole cookie rather than
  // silently appending to a stale session the visitor may not know is
  // still there on a shared device.
  const addAccount = req.nextUrl.searchParams.get("addAccount") === "true";
  const existing = addAccount ? await getSessionCookie() : null;

  const newEntry = { userId: user.id, username: user.username, token };
  const withoutThisUser = (existing?.accounts ?? []).filter((a) => a.userId !== user.id);
  const accounts = [...withoutThisUser, newEntry].slice(-MAX_ACCOUNTS);

  await writeSessionCookie({ activeUserId: user.id, accounts });

  return NextResponse.json({ user });
}

export async function DELETE(req: NextRequest) {
  // ?all=true: "Log out of all accounts." Otherwise: "Log out of [current
  // account]" — removes just the active one and falls back to whichever
  // account is next in the list, if any are left.
  const logoutAll = req.nextUrl.searchParams.get("all") === "true";
  if (logoutAll) {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const session = await getSessionCookie();
  if (!session) {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const remaining = session.accounts.filter((a) => a.userId !== session.activeUserId);
  if (remaining.length === 0) {
    await clearSessionCookie();
  } else {
    await writeSessionCookie({ activeUserId: remaining[remaining.length - 1]!.userId, accounts: remaining });
  }
  return NextResponse.json({ ok: true });
}
