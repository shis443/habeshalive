import type { FastifyPluginAsync } from "fastify";
import { getAdminSummary, listActiveBoosts } from "./service.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", { preHandler: app.requireAdmin }, async () => getAdminSummary());
  app.get("/boosts", { preHandler: app.requireAdmin }, async () => listActiveBoosts());
};
