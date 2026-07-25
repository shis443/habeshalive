import { createHmac, randomBytes } from "node:crypto";
import { env } from "../common/env.js";

// Centrifugo connection tokens are plain HS256 JWTs signed with its own
// token_hmac_secret_key (NOT this app's JWT_SECRET — a different secret,
// shared only with the Centrifugo deployment, see infra/centrifugo). No
// JWT library dependency needed for something this small: standard
// header.payload.signature, base64url-encoded, HMAC-SHA256 over
// "header.payload".
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signHs256(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", env.CENTRIFUGO_TOKEN_HMAC_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Centrifugo's "sub" claim identifies the connecting user; expiry forces
// the client to re-fetch a fresh token periodically rather than holding
// one indefinitely (Centrifugo's JS client calls back for a new token on
// expiry if the app wires that up — see ChatPanel.tsx).
//
// userId is optional on purpose: this connection token only grants
// permission to open a WebSocket and subscribe to public channels (real-
// time delivery of already-authored messages) — it is NOT what
// authenticates who *sent* a message. That happens separately, via the
// normal session-cookie-authenticated POST /chat/:streamId/messages route
// (proxied through apps/web's httpOnly-cookie-aware route, which a client
// component can't read directly — see apps/web/app/api/backend). Letting
// anonymous viewers hold a connection token too means everyone gets live
// updates, not just people who happen to be logged in, matching how chat
// works on comparable platforms (you can watch it scroll without an
// account, you just can't post).
export function createCentrifugoConnectionToken(userId?: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sub = userId ?? `anon-${randomBytes(8).toString("hex")}`;
  return signHs256({ sub, exp: nowSeconds + 60 * 60 });
}
