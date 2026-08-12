import { authResponseSchema, totpLoginVerifySchema } from "@birq/shared";
import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { completeSessionFromAuthResponse } from "../route";

// Second step of a 2FA-gated login — the caller already has a pendingToken
// from POST /api/session (its {requiresTotp, pendingToken} response) and
// now supplies the 6-digit code. Deliberately a separate route rather than
// overloading /api/session's body shape: this one carries a pendingToken +
// code, not an identifier/phone/email + password/OTP.
export async function POST(req: NextRequest) {
  const body = totpLoginVerifySchema.parse(await req.json());

  // Same rationale as /api/session/route.ts's identical try/catch: an
  // uncaught failure here used to cascade into a second, confusing parse
  // error on the client.
  let res: Response;
  let data: unknown;
  try {
    res = await fetch(`${API_INTERNAL_URL}/auth/2fa/login-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "Couldn't reach the server. Please try again." }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return completeSessionFromAuthResponse(authResponseSchema.parse(data), req);
}
