import { subscribeInputSchema, subscribeToPlatformSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { cancelPlatformSubscription, getMyPlatformSubscription, subscribeToPlatform } from "./platform-service.js";
import { cancelSubscription, listMySubscriptions, listTiers, subscribe } from "./service.js";

// Same per-user keying as wallet/routes.ts's keyByUser (each route file
// defines its own) — this is a real-money route (charges the wallet) that
// had no rate limit at all until now, unlike every comparable wallet/gift
// route.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tiers", async () => listTiers());

  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = subscribeInputSchema.parse(req.body);
      return subscribe(req.user.sub, input);
    }
  );

  app.get("/mine", { preHandler: app.authenticate }, async (req) => listMySubscriptions(req.user.sub));

  app.delete("/:id", { preHandler: app.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await cancelSubscription(req.user.sub, id);
    return { ok: true };
  });

  // Platform-wide sliding-scale ad-free subscription — no creator_id, one
  // per user (see platform-service.ts). Same rate-limit posture as the
  // per-creator subscribe route above: a real-money route, keyed per-user.
  app.post(
    "/platform",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = subscribeToPlatformSchema.parse(req.body);
      return subscribeToPlatform(req.user.sub, input.amountSantim);
    }
  );

  app.get("/platform/mine", { preHandler: app.authenticate }, async (req) =>
    getMyPlatformSubscription(req.user.sub)
  );

  app.delete("/platform", { preHandler: app.authenticate }, async (req) => {
    await cancelPlatformSubscription(req.user.sub);
    return { ok: true };
  });
};
