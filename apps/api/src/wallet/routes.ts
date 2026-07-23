import {
  chapaTransferWebhookSchema,
  chapaWebhookSchema,
  initiateTopupSchema,
  requestPayoutSchema,
  sendGiftSchema,
} from "@habeshalive/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import {
  approvePayout,
  completePayoutFromWebhook,
  completeTopupFromWebhook,
  getBalance,
  getEarningsThisMonth,
  initiateTopup,
  listGiftTypes,
  listPendingPayouts,
  listTransactions,
  requestPayout,
  sendGift,
} from "./service.js";

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

  app.get("/balance", { preHandler: app.authenticate }, async (req) => getBalance(req.user.sub));

  app.get("/earnings-this-month", { preHandler: app.authenticate }, async (req) =>
    getEarningsThisMonth(req.user.sub)
  );

  app.get("/transactions", { preHandler: app.authenticate }, async (req) =>
    listTransactions(req.user.sub)
  );

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

  app.post("/payouts/:id/approve", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    await approvePayout(id, req.user.sub);
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
