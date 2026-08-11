import { createClipSchema, publishVodSchema } from "@birq/shared";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../common/errors.js";
import {
  createClip,
  deleteClipOwned,
  getPublicClipById,
  incrementClipViews,
  listClipsForCreator,
} from "./clip-service.js";
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

  // Module 4 — 9:16 clipper. Runs ffmpeg synchronously (bounded by
  // createClipSchema's MAX_CLIP_DURATION_SECONDS cap so this stays fast
  // enough for a normal HTTP request/response, not a background job).
  app.post<{ Params: { id: string } }>(
    "/:id/clips",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler" } },
    },
    async (req) => {
      const input = createClipSchema.parse(req.body);
      return createClip(req.user.sub, req.params.id, input);
    }
  );

  app.get<{ Params: { username: string } }>("/:username/clips", async (req) =>
    listClipsForCreator(req.params.username)
  );

  // Phase 3.1 — public, independently-shareable clip. Registered as a
  // static "clips" segment (same as DELETE /clips/:id below), so it can't
  // be shadowed by the parametric "/:username" route above regardless of
  // registration order — same non-load-bearing-but-worth-noting point as
  // "/mine"'s own comment up top.
  app.get<{ Params: { id: string } }>("/clips/:id", async (req) => {
    const clip = await getPublicClipById(req.params.id);
    if (!clip) throw new AppError(404, "Clip not found");
    return clip;
  });

  // Public, unauthenticated, no rate limiting — same "count a play, not
  // an impression" convention as /:id/view above, fired once by the
  // client on first playback.
  app.post<{ Params: { id: string } }>("/clips/:id/view", async (req, reply) => {
    await incrementClipViews(req.params.id);
    reply.status(204).send();
  });

  app.delete<{ Params: { id: string } }>("/clips/:id", { preHandler: app.authenticate }, async (req, reply) => {
    await deleteClipOwned(req.params.id, req.user.sub);
    reply.status(204).send();
  });
};
