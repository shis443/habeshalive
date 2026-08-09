import { pinMessageSchema, sendChatMessageSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createCentrifugoConnectionToken } from "./token.js";
import {
  deleteChatMessage,
  getChatHistory,
  getPinnedMessage,
  getRecentGifters,
  pinMessage,
  sendChatMessage,
  unpinMessage,
} from "./service.js";

// Same keying rationale as wallet/routes.ts's keyByUser: this route already
// requires app.authenticate, so req.user.sub is reliably set by the time
// the rate-limit plugin's own preHandler-stage check runs.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  // Deliberately not auth-gated: anonymous viewers get a real-time
  // connection too (read-only in practice — see token.ts's comment).
  // Attaches the real user id when a valid session IS present so a
  // logged-in viewer's connection isn't needlessly anonymous, but doesn't
  // reject the request when one isn't.
  app.post("/token", async (req) => {
    let userId: string | undefined;
    try {
      await req.jwtVerify();
      userId = req.user.sub;
    } catch {
      userId = undefined;
    }
    return { token: createCentrifugoConnectionToken(userId) };
  });

  app.get<{ Params: { streamId: string } }>("/:streamId/messages", async (req) =>
    getChatHistory(req.params.streamId)
  );

  app.get<{ Params: { streamId: string } }>("/:streamId/pinned", async (req) =>
    getPinnedMessage(req.params.streamId)
  );

  app.post<{ Params: { streamId: string } }>(
    "/:streamId/pinned",
    { preHandler: app.authenticate },
    async (req) => {
      const input = pinMessageSchema.parse(req.body);
      return pinMessage(req.user.sub, req.params.streamId, input.messageId);
    }
  );

  app.delete<{ Params: { streamId: string } }>(
    "/:streamId/pinned",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await unpinMessage(req.user.sub, req.params.streamId);
      reply.send({ ok: true });
    }
  );

  app.get<{ Params: { streamId: string } }>("/:streamId/recent-gifters", async (req) =>
    getRecentGifters(req.params.streamId)
  );

  // Module 5 — soft-delete, gated the same three ways pin/unpin above
  // already are (chat/service.ts's assertCanModerateStream: owner,
  // platform staff, or a granted channel moderator).
  app.delete<{ Params: { streamId: string; messageId: string } }>(
    "/:streamId/messages/:messageId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      await deleteChatMessage(req.user.sub, req.params.streamId, req.params.messageId);
      reply.send({ ok: true });
    }
  );

  app.post<{ Params: { streamId: string } }>(
    "/:streamId/messages",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      // Chat spam is a real abuse vector (same class of concern as gifts),
      // and this is a fresh write endpoint — 20/min is generous for actual
      // conversation but stops a scripted flood.
      config: { rateLimit: { max: 20, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = sendChatMessageSchema.parse(req.body);
      return sendChatMessage(req.user.sub, req.params.streamId, input.body);
    }
  );
};
