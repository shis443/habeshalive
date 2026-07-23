import type { FastifyPluginAsync } from "fastify";
import { getAdminSummary } from "./service.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", { preHandler: app.requireAdmin }, async () => getAdminSummary());
};
