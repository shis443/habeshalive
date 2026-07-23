import { cookies } from "next/headers";
import { API_INTERNAL_URL } from "./config";

export const SESSION_COOKIE = "session";

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
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
