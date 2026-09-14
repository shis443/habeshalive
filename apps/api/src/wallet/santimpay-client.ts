import { env } from "../common/env.js";

export interface SantimPayCheckoutCustomer {
  email: string;
  firstName: string;
  lastName: string;
}

export interface SantimPayClient {
  initializeCheckout(
    amountSantim: number,
    txRef: string,
    customer: SantimPayCheckoutCustomer
  ): Promise<{ checkoutUrl: string }>;
}

// Dev-only stub — same "isConfigured" gate every optional-integration
// client in this codebase uses (see wallet/chapa-client.ts). Used
// whenever SANTIMPAY_API_KEY/SANTIMPAY_MERCHANT_ID are unset — true today
// regardless of environment, see isSantimPayConfigured below.
class StubSantimPayClient implements SantimPayClient {
  async initializeCheckout(_amountSantim: number, txRef: string): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://stub-checkout.santimpay.com/pay/${txRef}` };
  }
}

// Unlike RealChapaClient/RealStripeClient (each built against a real,
// dated API doc — see those files' own comments), no real SantimPay
// merchant account, API contract, or webhook signature scheme has been
// supplied to this project to verify against. Guessing at an endpoint
// shape and shipping it as "real" would be worse than not having it:
// a silently-wrong integration that looks configured. This throws
// instead, so wiring up real credentials later requires actually
// implementing this against SantimPay's real docs, not just setting env
// vars against unverified code.
class UnimplementedRealSantimPayClient implements SantimPayClient {
  async initializeCheckout(): Promise<{ checkoutUrl: string }> {
    throw new Error(
      "SantimPay credentials are set, but the real API integration hasn't been implemented yet — " +
        "see wallet/santimpay-client.ts. Unset SANTIMPAY_API_KEY/SANTIMPAY_MERCHANT_ID to fall back to the stub."
    );
  }
}

export const isSantimPayConfigured = Boolean(env.SANTIMPAY_API_KEY && env.SANTIMPAY_MERCHANT_ID);

export const santimpayClient: SantimPayClient = isSantimPayConfigured
  ? new UnimplementedRealSantimPayClient()
  : new StubSantimPayClient();

// Mirrors wallet/routes.ts's verifyChapaSignature shape (HMAC over the
// raw webhook body, timing-safe compare) so the route wiring is uniform
// across providers — but, same reasoning as UnimplementedRealSantimPayClient
// above, this can't be verified against a real SantimPay webhook doc yet.
// Always returns false: SANTIMPAY_WEBHOOK_SECRET being set is not, by
// itself, proof this scheme matches what SantimPay actually sends, so the
// route stays refusing (501) rather than accepting a webhook this
// function can't genuinely vouch for.
export function verifySantimPaySignature(): boolean {
  return false;
}
