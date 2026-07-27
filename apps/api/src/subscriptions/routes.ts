import { subscribeInputSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { cancelSubscription, listMySubscriptions, listTiers, subscribe } from "./service.js";

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tiers", async () => listTiers());

  app.post("/", { preHandler: app.authenticate }, async (req) => {
    const input = subscribeInputSchema.parse(req.body);
    return subscribe(req.user.sub, input);
  });

  app.get("/mine", { preHandler: app.authenticate }, async (req) => listMySubscriptions(req.user.sub));

  app.delete("/:id", { preHandler: app.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await cancelSubscription(req.user.sub, id);
    return { ok: true };
  });
};
