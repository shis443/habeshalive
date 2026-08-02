import { updateNotificationPreferencesSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  getPreferences,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  updatePreferences,
} from "./service.js";

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { before?: string } }>("/", { preHandler: app.authenticate }, async (req) =>
    listNotifications(req.user.sub, 30, req.query.before)
  );

  app.get("/unread-count", { preHandler: app.authenticate }, async (req) => ({
    count: await getUnreadCount(req.user.sub),
  }));

  app.post<{ Params: { id: string } }>("/:id/read", { preHandler: app.authenticate }, async (req, reply) => {
    await markRead(req.user.sub, req.params.id);
    reply.send({ ok: true });
  });

  app.post("/read-all", { preHandler: app.authenticate }, async (req, reply) => {
    await markAllRead(req.user.sub);
    reply.send({ ok: true });
  });

  app.get("/preferences", { preHandler: app.authenticate }, async (req) => getPreferences(req.user.sub));

  app.patch("/preferences", { preHandler: app.authenticate }, async (req) => {
    const input = updateNotificationPreferencesSchema.parse(req.body);
    return updatePreferences(req.user.sub, input);
  });
};
