import { subscribeInputSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
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
};
