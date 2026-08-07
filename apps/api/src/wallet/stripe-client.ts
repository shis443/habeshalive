import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../common/env.js";

export interface StripeCheckoutCustomer {
  email: string;
}

export interface StripeClient {
  createCheckoutSession(
    amountUsdCents: number,
    reference: string,
    customer: StripeCheckoutCustomer
  ): Promise<{ checkoutUrl: string }>;
}

// Dev-only stub — used whenever STRIPE_SECRET_KEY is unset. Same
// stub-vs-real switch every optional-integration client in this codebase
// uses (see wallet/chapa-client.ts).
class StubStripeClient implements StripeClient {
  async createCheckoutSession(_amountUsdCents: number, reference: string): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://stub-checkout.stripe.com/pay/${reference}` };
  }
}

interface StripeCheckoutSessionResponse {
  id?: string;
  url?: string;
  error?: { message?: string };
}

// Real Stripe Checkout Session (mode=payment, fixed one-time amount via
// price_data rather than a pre-created Price object) — contract verified
// against https://docs.stripe.com/api/checkout/sessions/create
// (2026-08-07): endpoint, Basic-auth-with-secret-key-as-username,
// x-www-form-urlencoded body shape (including the line_items[0][...]
// bracket-array encoding Stripe's non-JSON form API expects), and the
// {id, url} response fields. client_reference_id carries our internal
// ledger_transactions.reference for the webhook to match back to —
// same role tx_ref plays for Chapa.
class RealStripeClient implements StripeClient {
  async createCheckoutSession(
    amountUsdCents: number,
    reference: string,
    customer: StripeCheckoutCustomer
  ): Promise<{ checkoutUrl: string }> {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: `${env.WEB_PUBLIC_URL}/wallet`,
      cancel_url: `${env.WEB_PUBLIC_URL}/wallet`,
      client_reference_id: reference,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amountUsdCents),
      "line_items[0][price_data][product_data][name]": "Birq wallet top-up",
      "line_items[0][quantity]": "1",
      "customer_email": customer.email,
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.STRIPE_SECRET_KEY}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = (await res.json()) as StripeCheckoutSessionResponse;
    if (!res.ok || !data.url) {
      throw new Error(`Stripe checkout session failed: ${res.status} ${data.error?.message ?? "unknown error"}`);
    }
    return { checkoutUrl: data.url };
  }
}

export const stripeClient: StripeClient = env.STRIPE_SECRET_KEY ? new RealStripeClient() : new StubStripeClient();

// Manual HMAC-SHA256 verification of the Stripe-Signature header — no SDK
// dependency, same "small, precisely-specified, worth verifying by hand"
// reasoning as common/crypto.ts's AES-GCM and auth/totp.ts's TOTP.
// Algorithm verified against https://docs.stripe.com/webhooks/signatures
// (2026-08-07): header is "t=<unix seconds>,v1=<hex hmac>[,v0=...]",
// signed_payload is "{timestamp}.{raw body}", HMAC-SHA256 keyed by the
// endpoint's webhook signing secret. 5-minute tolerance matches Stripe's
// own library default, explicitly called out in their docs as required
// (not optional) to prevent replay.
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
