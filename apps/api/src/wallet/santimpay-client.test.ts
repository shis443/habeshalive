import { describe, expect, it } from "vitest";
import { isSantimPayConfigured, santimpayClient, verifySantimPaySignature } from "./santimpay-client.js";

// SANTIMPAY_API_KEY/SANTIMPAY_MERCHANT_ID are unset in this test env (see
// .env.example and env.ts's own comment) — same stub-mode assumption
// wallet/chapa-client.test.ts-equivalent coverage would make for Chapa,
// verified explicitly here rather than assumed.
describe("santimpayClient (stub mode)", () => {
  it("is not configured without real credentials", () => {
    expect(isSantimPayConfigured).toBe(false);
  });

  it("returns a stub checkout URL carrying the tx reference", async () => {
    const { checkoutUrl } = await santimpayClient.initializeCheckout(10_000, "topup_abc123", {
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
    });
    expect(checkoutUrl).toBe("https://stub-checkout.santimpay.com/pay/topup_abc123");
  });
});

describe("verifySantimPaySignature", () => {
  it("always refuses — no real webhook contract to verify against yet", () => {
    expect(verifySantimPaySignature()).toBe(false);
  });
});
