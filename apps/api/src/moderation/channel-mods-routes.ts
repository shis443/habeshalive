import { blockViewerSchema, grantChannelModeratorSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  blockViewerFromChannel,
  grantChannelModerator,
  listChannelBlocks,
  listChannelModerators,
  listChannelsIModerate,
  revokeChannelModerator,
  unblockViewerFromChannel,
} from "./channel-mods-service.js";

// Module 5 — per-channel moderator RBAC. Deliberately keyed by :creatorId
// in the URL, not "mine" — grant/revoke stays owner-only (enforced inside
// channel-mods-service.ts's assertIsChannelOwner), but a granted channel
// moderator needs to reach a channel that isn't their own to manage its
// blocks (assertCanManageChannel), so "mine" alone wouldn't cover that
// caller.
export const channelModsRoutes: FastifyPluginAsync = async (app) => {
  // Creator Dashboard's Community > My Assigned Roles. Registered before
  // the parametric "/:creatorId/moderators" below — same static-before-
  // parametric registration-order note as vods/routes.ts's "/mine": not
  // load-bearing (Fastify prioritizes static segments regardless), just
  // there for a future reader.
  app.get("/mine", { preHandler: app.authenticate }, async (req) => listChannelsIModerate(req.user.sub));

  app.get<{ Params: { creatorId: string } }>(
    "/:creatorId/moderators",
    { preHandler: app.authenticate },
    async (req) => listChannelModerators(req.params.creatorId, req.user.sub)
  );

  app.post<{ Params: { creatorId: string } }>(
    "/:creatorId/moderators",
    { preHandler: app.authenticate },
    async (req) => {
      const input = grantChannelModeratorSchema.parse(req.body);
      return grantChannelModerator(req.params.creatorId, req.user.sub, input.username);
    }
  );

  app.delete<{ Params: { creatorId: string; userId: string } }>(
    "/:creatorId/moderators/:userId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await revokeChannelModerator(req.params.creatorId, req.user.sub, req.params.userId);
      reply.send({ ok: true });
    }
  );

  app.get<{ Params: { creatorId: string } }>(
    "/:creatorId/blocks",
    { preHandler: app.authenticate },
    async (req) => listChannelBlocks(req.params.creatorId, req.user.sub)
  );

  app.post<{ Params: { creatorId: string } }>(
    "/:creatorId/blocks",
    { preHandler: app.authenticate },
    async (req) => {
      const input = blockViewerSchema.parse(req.body);
      return blockViewerFromChannel(req.params.creatorId, req.user.sub, input.username);
    }
  );

  app.delete<{ Params: { creatorId: string; userId: string } }>(
    "/:creatorId/blocks/:userId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await unblockViewerFromChannel(req.params.creatorId, req.user.sub, req.params.userId);
      reply.send({ ok: true });
    }
  );
};
