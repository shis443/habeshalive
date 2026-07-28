import type { FastifyPluginAsync } from "fastify";
import { getAdminSummary, listActiveBoosts, listAdminActions } from "./service.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", { preHandler: app.requireAdmin }, async () => getAdminSummary());
  app.get("/boosts", { preHandler: app.requireAdmin }, async () => listActiveBoosts());
  app.get("/audit-log", { preHandler: app.requireAdmin }, async () => listAdminActions());
};
