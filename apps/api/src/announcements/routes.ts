import type { FastifyPluginAsync } from "fastify";
import { listActiveAnnouncements } from "./service.js";

export const announcementRoutes: FastifyPluginAsync = async (app) => {
  // Public — the dismissible banner is visible to logged-out visitors too.
  app.get("/", async () => listActiveAnnouncements());
};
