import { grantRemoteControlAssistantSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  grantRemoteControlAssistant,
  listRemoteControlAssistants,
  revokeRemoteControlAssistant,
} from "./assistants-service.js";
import { AppError } from "../common/errors.js";
import { logTicketDenied, mintTicket, resolveScope } from "./ticket-service.js";

const ticketRequestSchema = z.object({ streamerId: z.string().min(1) });

// Keyed by user, not IP — same deliberate choice as wallet/routes.ts's
// gifts/topups/payouts (see app.ts's own comment on why authenticated
// mutation routes here key on something more meaningful than a shared
// container IP). Every caller of this route is already authenticated
// (app.authenticate below), so there's no anonymous-viewer case to also
// cover the way whep-routes.ts's keyByViewer needs to.
function keyByUser(req: FastifyRequest): string {
  return `user:${req.user!.sub}`;
}

export const remoteControlRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/ticket",
    {
      preHandler: app.authenticate,
      config: {
        rateLimit: { max: 10, timeWindow: "5 minutes", hook: "preHandler", skipOnError: false, keyGenerator: keyByUser },
      },
    },
    async (req) => {
      const { streamerId } = ticketRequestSchema.parse(req.body);
      const userId = req.user!.sub;

      const scope = await resolveScope(userId, streamerId);
      if (!scope) {
        await logTicketDenied(userId, streamerId);
        // Same shape whether the streamer id is unknown or just not
        // controllable by this caller — don't let this route be used to
        // enumerate which streamer ids exist.
        throw new AppError(403, "Forbidden");
      }

      return mintTicket(userId, streamerId, scope);
    }
  );

  // Creator settings' assistant management — grant/revoke, owner-only
  // (enforced inside assistants-service.ts's assertIsStreamerOwner).
  // Deliberately keyed by :streamerId, not "mine": unlike vods/routes.ts's
  // "mine" pattern, there's no non-owner caller who ever needs to reach
  // this (an assistant can't manage their own grant), so the extra static
  // route isn't needed here the way channel-mods-routes.ts's /mine is for
  // a granted moderator reaching a channel that isn't theirs.
  app.get<{ Params: { streamerId: string } }>(
    "/:streamerId/assistants",
    { preHandler: app.authenticate },
    async (req) => listRemoteControlAssistants(req.params.streamerId, req.user!.sub)
  );

  app.post<{ Params: { streamerId: string } }>(
    "/:streamerId/assistants",
    { preHandler: app.authenticate },
    async (req) => {
      const input = grantRemoteControlAssistantSchema.parse(req.body);
      return grantRemoteControlAssistant(req.params.streamerId, req.user!.sub, input.username);
    }
  );

  app.delete<{ Params: { streamerId: string; userId: string } }>(
    "/:streamerId/assistants/:userId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await revokeRemoteControlAssistant(req.params.streamerId, req.user!.sub, req.params.userId);
      reply.send({ ok: true });
    }
  );
};
