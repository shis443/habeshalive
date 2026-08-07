import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../common/env.js";
import { verifyStripeSignature } from "./stripe-client.js";

// Real HMAC-SHA256 computed the same way Stripe's own libraries do (see
// stripe-client.ts's own doc comment for the verified algorithm) —
// STRIPE_WEBHOOK_SECRET is unset in this test env (dormant feature, no
// real Stripe account), so these tests build the header by hand against
// whatever env.STRIPE_WEBHOOK_SECRET actually resolves to, rather than
// hardcoding a secret value that wouldn't match.
function buildSignatureHeader(rawBody: string, timestamp: number): string {
  const signature = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed, fresh payload", () => {
    const rawBody = JSON.stringify({ type: "checkout.session.completed" });
    const header = buildSignatureHeader(rawBody, Math.floor(Date.now() / 1000));
    expect(verifyStripeSignature(rawBody, header)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify({ type: "checkout.session.completed" });
    const header = buildSignatureHeader(rawBody, Math.floor(Date.now() / 1000));
    expect(verifyStripeSignature(JSON.stringify({ type: "tampered" }), header)).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", () => {
    const rawBody = JSON.stringify({ type: "checkout.session.completed" });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1h old
    const header = buildSignatureHeader(rawBody, staleTimestamp);
    expect(verifyStripeSignature(rawBody, header)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyStripeSignature("{}", undefined)).toBe(false);
    expect(verifyStripeSignature("{}", "not-a-real-header")).toBe(false);
    expect(verifyStripeSignature("{}", "t=123")).toBe(false); // no v1=
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify({ type: "checkout.session.completed" });
    const timestamp = Math.floor(Date.now() / 1000);
    const wrongSignature = createHmac("sha256", "wrong-secret").update(`${timestamp}.${rawBody}`).digest("hex");
    expect(verifyStripeSignature(rawBody, `t=${timestamp},v1=${wrongSignature}`)).toBe(false);
  });
});
