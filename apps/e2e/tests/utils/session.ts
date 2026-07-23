import { createHmac } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

// Mints a JWT the same shape apps/api/src/auth/routes.ts's jwtSign
// produces ({ sub, role }, HS256) and injects it directly as the
// `session` cookie apps/web/app/api/session/route.ts sets on real login —
// lets tests skip the OTP UI for pages that only need *a* valid session,
// while still exercising the real API with a real, correctly-signed
// token (not a mocked auth layer).
function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintJwt(payload: { sub: string; role: string }): string {
  const secret = process.env.JWT_SECRET ?? "dev-only-change-me";
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })));
  const signature = base64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

export async function loginAs(context: BrowserContext, userId: string, role: string): Promise<void> {
  const token = mintJwt({ sub: userId, role });
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  await context.addCookies([
    {
      name: "session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
