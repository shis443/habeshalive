import { env } from "../common/env.js";

export interface PaypalClient {
  createOrder(amountUsdCents: number, reference: string): Promise<{ checkoutUrl: string }>;
}

// Dev-only stub — used whenever PAYPAL_CLIENT_ID/SECRET are unset. Same
// stub-vs-real switch every optional-integration client in this codebase
// uses (see wallet/chapa-client.ts).
class StubPaypalClient implements PaypalClient {
  async createOrder(_amountUsdCents: number, reference: string): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://stub-checkout.paypal.com/pay/${reference}` };
  }
}

interface PaypalOauthTokenResponse {
  access_token?: string;
  error?: string;
}

interface PaypalOrderResponse {
  id?: string;
  links?: { rel: string; href: string }[];
  message?: string;
}

// Shared by RealPaypalClient.createOrder and verifyPaypalWebhook below —
// both need a fresh app-level (client-credentials) access token, not a
// user's own OAuth token.
async function getAccessToken(): Promise<string> {
  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = (await res.json()) as PaypalOauthTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal OAuth token request failed: ${res.status} ${data.error ?? "unknown error"}`);
  }
  return data.access_token;
}

// Real PayPal Orders v2 integration — contract verified against
// https://developer.paypal.com (2026-08-07):
//  - OAuth2 client-credentials token: POST /v1/oauth2/token, HTTP Basic
//    auth with client id/secret, x-www-form-urlencoded
//    "grant_type=client_credentials" body, {access_token} response.
//  - Order creation: POST /v2/checkout/orders, Bearer token auth,
//    {intent: "CAPTURE", purchase_units: [{reference_id, amount: {
//    currency_code, value}}]} body, {id, links} response — the buyer
//    redirect URL is the entry in `links` whose rel is "approve".
// No SDK dependency, same reasoning as chapa-client.ts/stripe-client.ts —
// two small REST calls don't justify a new npm package.
class RealPaypalClient implements PaypalClient {
  async createOrder(amountUsdCents: number, reference: string): Promise<{ checkoutUrl: string }> {
    const accessToken = await getAccessToken();
    const res = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: reference,
            amount: { currency_code: "USD", value: (amountUsdCents / 100).toFixed(2) },
          },
        ],
        application_context: {
          return_url: `${env.WEB_PUBLIC_URL}/wallet`,
          cancel_url: `${env.WEB_PUBLIC_URL}/wallet`,
        },
      }),
    });

    const data = (await res.json()) as PaypalOrderResponse;
    const approveUrl = data.links?.find((link) => link.rel === "approve")?.href;
    if (!res.ok || !approveUrl) {
      throw new Error(`PayPal order creation failed: ${res.status} ${data.message ?? "unknown error"}`);
    }
    return { checkoutUrl: approveUrl };
  }
}

export const paypalClient: PaypalClient =
  env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? new RealPaypalClient() : new StubPaypalClient();

interface PaypalVerifyWebhookResponse {
  verification_status?: "SUCCESS" | "FAILURE";
}

// PayPal's webhook model is structurally different from Chapa/Stripe's
// local-HMAC approach — verification is itself a server-to-server API
// call (POST /v1/notifications/verify-webhook-signature), not a
// signature you compute yourself. Contract verified against
// https://developer.paypal.com/api/rest/webhooks/ (2026-08-07): the five
// paypal-transmission-*/cert-url headers plus the configured webhookId
// and the raw parsed event body get posted back to PayPal, which returns
// {verification_status: "SUCCESS" | "FAILURE"}.
export async function verifyPaypalWebhook(
  headers: { transmissionId?: string; transmissionTime?: string; certUrl?: string; transmissionSig?: string },
  webhookEvent: unknown
): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const { transmissionId, transmissionTime, certUrl, transmissionSig } = headers;
  if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig) return false;

  const accessToken = await getAccessToken();
  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: "SHA256withRSA",
      transmission_sig: transmissionSig,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: webhookEvent,
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as PaypalVerifyWebhookResponse;
  return data.verification_status === "SUCCESS";
}
