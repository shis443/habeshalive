import {
  chapaTransferWebhookSchema,
  chapaWebhookSchema,
  donateSchema,
  initiateDiasporaTopupSchema,
  initiateTopupSchema,
  rejectPayoutSchema,
  requestPayoutSchema,
  sendGiftSchema,
} from "@habeshalive/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import { initiateDiasporaTopup } from "./diaspora-topup-service.js";
import { verifyPaypalWebhook } from "./paypal-client.js";
import {
  approvePayout,
  completePayoutFromWebhook,
  completeTopupFromWebhook,
  exportEarningsCsv,
  getBalance,
  getCreatorPayoutContext,
  getEarningsThisMonth,
  getGifterBadge,
  getUserRank,
  initiateTopup,
  listAllPayouts,
  listGiftTiers,
  listGiftTypes,
  listPendingPayouts,
  listTransactions,
  rejectPayout,
  requestPayout,
  sendDonation,
  sendGift,
} from "./service.js";
import { verifyStripeSignature } from "./stripe-client.js";

// User-keyed, not IP-keyed: apps/web's Server Components and its
// /api/backend proxy both call this API server-to-server from the web
// container's one fixed IP, so EVERY real user's mutations funnel through
// that same address — an IP-keyed limit here would be one shared bucket
// for the entire platform's gifts/topups/payouts, not a per-user limit.
// Requires `hook: "preHandler"` on the route's rateLimit config — the
// plugin's default hook (`onRequest`) runs before Fastify's preHandler
// phase even starts, i.e. before `app.authenticate` populates `req.user`.
// Verified live, not assumed: exhausted one user's limit (30 req to
// /gifts), immediately hit the same route from a second user on the same
// source IP, and the second user was unaffected — proved the bucket is
// genuinely per-user before relying on it.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

// Chapa signs webhook deliveries with HMAC-SHA256(webhook_secret, raw JSON
// body) in the `x-chapa-signature` header — verified against
// https://developer.chapa.co/docs/webhooks (2026-07-22). Needs the exact
// raw bytes Chapa signed, not a re-serialization of the parsed object
// (key ordering could differ), hence the rawBody capture below.
function verifyChapaSignature(req: FastifyRequest): boolean {
  if (!env.CHAPA_WEBHOOK_SECRET) return false;
  const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody;
  const provided = req.headers["x-chapa-signature"];
  if (!rawBody || typeof provided !== "string") return false;

  const expected = createHmac("sha256", env.CHAPA_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export const walletRoutes: FastifyPluginAsync = async (app) => {
  // Scoped to this plugin only (Fastify encapsulates content-type parser
  // overrides) — captures the exact raw body text alongside the normal
  // parsed JSON, so the Chapa webhook route can verify against it.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    if (!body) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/gift-types", async () => listGiftTypes());

  // Grouped-by-tier shape for the Send Gursha modal's tier-then-theme
  // selector — see wallet/service.ts's listGiftTiers.
  app.get("/gift-tiers", async () => listGiftTiers());

  // Platform-wide Rank (cumulative Gursha spend across every creator) —
  // distinct from /gifter-badge/:creatorId below, which is per-creator.
  app.get("/rank", { preHandler: app.authenticate }, async (req) => getUserRank(req.user.sub));

  app.get("/balance", { preHandler: app.authenticate }, async (req) => getBalance(req.user.sub));

  app.get("/earnings-this-month", { preHandler: app.authenticate }, async (req) =>
    getEarningsThisMonth(req.user.sub)
  );

  app.get("/transactions", { preHandler: app.authenticate }, async (req) =>
    listTransactions(req.user.sub)
  );

  // Real ledger data only — see exportEarningsCsv's own comment for why
  // this deliberately doesn't claim to implement any specific tax
  // jurisdiction's compliance rules.
  app.get("/earnings-export", { preHandler: app.authenticate }, async (req, reply) => {
    const csv = await exportEarningsCsv(req.user.sub);
    reply.header("Content-Type", "text/csv").header("Content-Disposition", "attachment; filename=\"birq-earnings.csv\"").send(csv);
  });

  app.post(
    "/topups",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = initiateTopupSchema.parse(req.body);
      return initiateTopup(req.user.sub, input.amountSantim);
    }
  );

  app.post("/webhooks/chapa", async (req, reply) => {
    // No CHAPA_WEBHOOK_SECRET configured (dev/stub mode, no real Chapa
    // account) means signature verification can't run — refuse rather than
    // silently accept unauthenticated wallet credits.
    if (!env.CHAPA_WEBHOOK_SECRET) {
      throw new AppError(501, "Chapa webhook verification not configured");
    }
    if (!verifyChapaSignature(req)) {
      throw new AppError(401, "Invalid webhook signature");
    }
    const input = chapaWebhookSchema.parse(req.body);
    await completeTopupFromWebhook(input);
    reply.send({ ok: true });
  });

  // Module 2 diaspora bridge — see diaspora-topup-service.ts's own
  // comment on why Telebirr/CBE Birr have no equivalent route here.
  app.post(
    "/topups/diaspora",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = initiateDiasporaTopupSchema.parse(req.body);
      return initiateDiasporaTopup(req.user.sub, input.amountUsdCents, input.provider);
    }
  );

  app.post("/webhooks/stripe", async (req, reply) => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError(501, "Stripe webhook verification not configured");
    }
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody;
    if (!verifyStripeSignature(rawBody ?? "", req.headers["stripe-signature"] as string | undefined)) {
      throw new AppError(401, "Invalid webhook signature");
    }
    const event = req.body as {
      type?: string;
      data?: { object?: { client_reference_id?: string; amount_total?: number; payment_status?: string } };
    };
    const session = event.data?.object;
    if (event.type === "checkout.session.completed" && session?.client_reference_id) {
      await completeTopupFromWebhook({
        tx_ref: session.client_reference_id,
        status: session.payment_status === "paid" ? "success" : "failed",
        amount: (session.amount_total ?? 0) / 100,
        currency: "usd",
      });
    }
    reply.send({ ok: true });
  });

  app.post("/webhooks/paypal", async (req, reply) => {
    if (!env.PAYPAL_WEBHOOK_ID) {
      throw new AppError(501, "PayPal webhook verification not configured");
    }
    const verified = await verifyPaypalWebhook(
      {
        transmissionId: req.headers["paypal-transmission-id"] as string | undefined,
        transmissionTime: req.headers["paypal-transmission-time"] as string | undefined,
        certUrl: req.headers["paypal-cert-url"] as string | undefined,
        transmissionSig: req.headers["paypal-transmission-sig"] as string | undefined,
      },
      req.body
    );
    if (!verified) {
      throw new AppError(401, "Invalid webhook signature");
    }
    const event = req.body as {
      event_type?: string;
      resource?: { purchase_units?: { reference_id?: string }[]; amount?: { value?: string } };
    };
    const referenceId = event.resource?.purchase_units?.[0]?.reference_id;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && referenceId) {
      await completeTopupFromWebhook({
        tx_ref: referenceId,
        status: "success",
        amount: Number(event.resource?.amount?.value ?? 0),
        currency: "usd",
      });
    }
    reply.send({ ok: true });
  });

  app.post(
    "/gifts",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = sendGiftSchema.parse(req.body);
      return sendGift(req.user.sub, input);
    }
  );

  app.post(
    "/donations",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = donateSchema.parse(req.body);
      return sendDonation(req.user.sub, input);
    }
  );

  // Lets the Gursha modal show a "you're this far from the next badge"
  // progress bar before the viewer has sent anything this session.
  app.get<{ Params: { creatorId: string } }>(
    "/gifter-badge/:creatorId",
    { preHandler: app.authenticate },
    async (req) => getGifterBadge(req.user.sub, req.params.creatorId)
  );

  app.post(
    "/payouts",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = requestPayoutSchema.parse(req.body);
      return requestPayout(req.user.sub, input);
    }
  );

  app.get("/payouts/pending", { preHandler: app.requireAdmin }, async () => listPendingPayouts());

  app.get<{ Querystring: { status?: string; creator?: string } }>(
    "/payouts/history",
    { preHandler: app.requireAdmin },
    async (req) =>
      listAllPayouts({
        status: req.query.status as never,
        creatorUsername: req.query.creator,
      })
  );

  app.get<{ Params: { creatorId: string } }>(
    "/payouts/creator-context/:creatorId",
    { preHandler: app.requireAdmin },
    async (req) => getCreatorPayoutContext(req.params.creatorId)
  );

  app.post("/payouts/:id/approve", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    await approvePayout(id, req.user.sub);
    return { ok: true };
  });

  app.post("/payouts/:id/reject", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const input = rejectPayoutSchema.parse(req.body);
    await rejectPayout(id, req.user.sub, input.reason);
    return { ok: true };
  });

  app.post("/webhooks/chapa-transfer", async (req, reply) => {
    if (!env.CHAPA_WEBHOOK_SECRET) {
      throw new AppError(501, "Chapa webhook verification not configured");
    }
    if (!verifyChapaSignature(req)) {
      throw new AppError(401, "Invalid webhook signature");
    }
    const input = chapaTransferWebhookSchema.parse(req.body);
    await completePayoutFromWebhook(input);
    reply.send({ ok: true });
  });
};
