import { cookies } from "next/headers";
import { API_INTERNAL_URL } from "./config";

export const SESSION_COOKIE = "session";

// [CONFIRM] default: true multi-session (E.2), max 5 concurrent accounts.
export const MAX_ACCOUNTS = 5;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionAccountEntry {
  userId: string;
  username: string;
  token: string;
}

export interface SessionCookieValue {
  activeUserId: string;
  accounts: SessionAccountEntry[];
}

// The cookie's VALUE changed shape (a bare JWT string -> a JSON blob
// holding possibly several accounts' tokens) but the cookie itself stays
// httpOnly and same-named — tokens still never reach client JS. This is
// the deliberate adaptation of E.2's "multi-session" requirement to how
// auth actually works here: the spec assumed a localStorage token pair
// (confirmed absent from this codebase — grepped for `hl_token`/`hl_user`,
// zero hits), which would mean handing raw JWTs to client-side JS, a real
// XSS-exposure regression from the httpOnly cookie already in place.
// Switching accounts is still instant and re-auth-free (POST
// /api/session/switch just flips which token is "active" inside this one
// cookie, no Fastify API round-trip) — just without ever exposing a token
// to anything that isn't this server.
export async function getSessionCookie(): Promise<SessionCookieValue | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionCookieValue;
    if (!parsed.activeUserId || !Array.isArray(parsed.accounts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSessionCookie(value: SessionCookieValue): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// Every existing call site (dozens, across lib/api.ts) expects a bare
// token string — this stays the single point that resolves "the active
// account's token," so nothing outside session.ts and the /api/session/*
// route handlers needs to know the cookie holds more than one account.
export async function getSessionToken(): Promise<string | null> {
  const session = await getSessionCookie();
  if (!session) return null;
  return session.accounts.find((a) => a.userId === session.activeUserId)?.token ?? null;
}

// Server-side only (Server Components) — uses API_INTERNAL_URL, see config.ts.
export async function fetchAuthed(path: string, init?: RequestInit): Promise<Response> {
  const token = await getSessionToken();
  return fetch(`${API_INTERNAL_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
