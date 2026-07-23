import { subscribeInputSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { listTiers, subscribe } from "./service.js";

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tiers", async () => listTiers());

  app.post("/", { preHandler: app.authenticate }, async (req) => {
    const input = subscribeInputSchema.parse(req.body);
    return subscribe(req.user.sub, input);
  });
};
