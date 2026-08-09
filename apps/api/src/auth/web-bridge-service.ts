import { randomBytes } from "node:crypto";
import { redis } from "../common/redis.js";

const BRIDGE_CODE_TTL_SECONDS = 60;
const BRIDGE_CODE_PREFIX = "web-bridge:";

export interface BridgeCodePayload {
  userId: string;
  username: string;
  token: string;
}

// One-time, short-lived code that lets the mobile app open an already-authenticated web view
// (the wallet top-up flow, so Chapa/CBE Birr/HelloCash top-up runs through the real web checkout
// instead of native IAP) without ever putting the session JWT in a URL — apps/web/lib/session.ts
// deliberately keeps tokens out of anything URL/query-param-adjacent (httpOnly cookie only, to
// avoid XSS exposure), so a bearer token as a query param was never an option here. This is the
// standard OAuth-authorization-code pattern instead: opaque (256 bits), single-use (consumeWebBridgeCode
// below deletes it atomically on first read), and expires fast if the mobile app mints one but the
// user never actually opens the resulting link.
export async function createWebBridgeCode(userId: string, username: string, token: string): Promise<string> {
  const code = randomBytes(32).toString("hex");
  const payload: BridgeCodePayload = { userId, username, token };
  await redis.set(`${BRIDGE_CODE_PREFIX}${code}`, JSON.stringify(payload), "EX", BRIDGE_CODE_TTL_SECONDS);
  return code;
}

// GETDEL reads and deletes atomically in one round trip — a code can never be exchanged twice
// even under a race (e.g. the mobile web view double-firing the initial navigation).
export async function consumeWebBridgeCode(code: string): Promise<BridgeCodePayload | null> {
  const raw = await redis.getdel(`${BRIDGE_CODE_PREFIX}${code}`);
  if (!raw) return null;
  return JSON.parse(raw) as BridgeCodePayload;
}
