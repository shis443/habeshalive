import { publishVodSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  deleteVodOwned,
  incrementVodViews,
  listMyVods,
  listVodsForCreator,
  publishVod,
  unpublishVod,
} from "./service.js";

export const vodRoutes: FastifyPluginAsync = async (app) => {
  // Registered before the public /:username catch-all below — Fastify's
  // router prioritizes static path segments over parametric ones
  // regardless of registration order, so "/mine" already can't be shadowed
  // by ":username" matching the literal string "mine"; keeping it first
  // here is just for a future reader's sake, not load-bearing.
  app.get("/mine", { preHandler: app.authenticate }, async (req) => listMyVods(req.user.sub));

  app.patch<{ Params: { id: string } }>(
    "/:id/publish",
    { preHandler: app.authenticate },
    async (req) => {
      const input = publishVodSchema.parse(req.body ?? {});
      return publishVod(req.params.id, req.user.sub, input);
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/:id/unpublish",
    { preHandler: app.authenticate },
    async (req) => unpublishVod(req.params.id, req.user.sub)
  );

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: app.authenticate }, async (req, reply) => {
    await deleteVodOwned(req.params.id, req.user.sub);
    reply.status(204).send();
  });

  // Public, unauthenticated — a viewer's browser fires this once when
  // VodPlayer.tsx actually starts playback (not on every page load that
  // merely lists VODs), same "count a play, not an impression" convention
  // as most video platforms. No rate limiting: a real burst of views on a
  // popular VOD is the intended, functioning case, not abuse to guard
  // against — same reasoning as boostStream not rate-limiting concurrent
  // viewer-count reads.
  app.post<{ Params: { id: string } }>("/:id/view", async (req, reply) => {
    await incrementVodViews(req.params.id);
    reply.status(204).send();
  });

  app.get<{ Params: { username: string } }>("/:username", async (req) =>
    listVodsForCreator(req.params.username)
  );
};
