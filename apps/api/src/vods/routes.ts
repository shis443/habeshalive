import type { FastifyPluginAsync } from "fastify";
import { listVodsForCreator } from "./service.js";

export const vodRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { username: string } }>("/:username", async (req) =>
    listVodsForCreator(req.params.username)
  );
};
