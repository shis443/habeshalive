// Every response from the API (hit directly via API_BASE_URL, or through
// the /api/backend/* proxy, which passes bodies through unmodified) is
// wrapped in {success, data, error} by apps/api/src/app.ts's
// preSerialization hook. lib/api.ts's server-side data fetchers already
// account for this via their own unwrapData helper — but that file isn't
// safe to import into a "use client" component (it relies on server-only
// cookie access elsewhere), so this is the client-side equivalent.
//
// Found via a real, live crash: a "use client" component read a raw
// fetch response directly instead of unwrapping this envelope, so a
// value that should have been an array was actually {success, data,
// error} — calling .map()/.filter() on it threw "X is not a function"
// and took the whole page down. That specific instance is fixed, but the
// same pattern turned up in roughly 65 other client components — this
// helper exists so every one of them can be fixed the same, correct way
// instead of each reinventing (or missing) the unwrap.
export async function unwrapClientData<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? "Request failed");
  return body.data as T;
}
