import type { FastifyPluginAsync } from "fastify";
import { blockCreator, getBlockStatus, unblockCreator } from "./service.js";

export const blockRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { creatorId: string } }>(
    "/creators/:creatorId",
    { preHandler: app.authenticate },
    async (req) => getBlockStatus(req.user.sub, req.params.creatorId)
  );

  app.post<{ Params: { creatorId: string } }>(
    "/creators/:creatorId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await blockCreator(req.user.sub, req.params.creatorId);
      reply.status(204).send();
    }
  );

  app.delete<{ Params: { creatorId: string } }>(
    "/creators/:creatorId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await unblockCreator(req.user.sub, req.params.creatorId);
      reply.status(204).send();
    }
  );
};
