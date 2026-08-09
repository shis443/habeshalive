import { updateNotificationPreferencesSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  getPreferences,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  updatePreferences,
} from "./service.js";

// Same keying rationale as wallet/routes.ts's keyByUser.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

// Relied on the global 2000/min-per-IP default only (docs/SECURITY.md's
// known-gaps list). Applied to the mutating routes below, not the GETs —
// same "reads stay unlimited, writes get a backstop" convention already
// used across this codebase (e.g. GET /vods/mine, GET /moderation/
// channel/mine are unrated too).
const MUTATION_RATE_LIMIT = { max: 60, timeWindow: "1 minute", hook: "preHandler" as const, keyGenerator: keyByUser };

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { before?: string } }>("/", { preHandler: app.authenticate }, async (req) =>
    listNotifications(req.user.sub, 30, req.query.before)
  );

  app.get("/unread-count", { preHandler: app.authenticate }, async (req) => ({
    count: await getUnreadCount(req.user.sub),
  }));

  app.post<{ Params: { id: string } }>(
    "/:id/read",
    { preHandler: app.authenticate, config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      await markRead(req.user.sub, req.params.id);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/read-all",
    { preHandler: app.authenticate, config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      await markAllRead(req.user.sub);
      reply.send({ ok: true });
    }
  );

  app.get("/preferences", { preHandler: app.authenticate }, async (req) => getPreferences(req.user.sub));

  app.patch(
    "/preferences",
    { preHandler: app.authenticate, config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const input = updateNotificationPreferencesSchema.parse(req.body);
      return updatePreferences(req.user.sub, input);
    }
  );
};
