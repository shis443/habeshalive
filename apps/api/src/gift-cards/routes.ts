import { purchaseGiftCardSchema, redeemGiftCardSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getGiftCardPreview, getMyGiftCards, purchaseGiftCard, redeemGiftCard } from "./service.js";

function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const giftCardRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      // Real-money purchases, same class of concern as payouts/topups —
      // fraud control per the spec's own ask ("rate-limit purchases").
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = purchaseGiftCardSchema.parse(req.body);
      return purchaseGiftCard(req.user.sub, input);
    }
  );

  app.get("/mine", { preHandler: app.authenticate }, async (req) => getMyGiftCards(req.user.sub));

  // Public — the redemption page needs to preview a card before the
  // viewer necessarily has an account/is logged in.
  app.get<{ Querystring: { code?: string } }>("/preview", async (req) => {
    if (!req.query.code) return null;
    return getGiftCardPreview(req.query.code);
  });

  app.post("/redeem", { preHandler: app.authenticate }, async (req) => {
    const input = redeemGiftCardSchema.parse(req.body);
    return redeemGiftCard(req.user.sub, input.code);
  });
};
