import { createStreamSchema, srsCallbackSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import {
  endStream,
  getCreatorStats,
  getLiveStreamByUsername,
  getStreamActivity,
  getStreamById,
  getStreamKey,
  goLive,
  listLiveStreams,
  markEndedByProviderStreamId,
  markLiveByProviderStreamId,
  rotateStreamKey,
} from "./service.js";

// SRS's http_hooks can't send custom headers — only a fully-specified URL —
// so the secret travels as a query param there. Other callers (tests, any
// future provider that *can* send headers) can still use the header.
function assertWebhookSecret(req: FastifyRequest): void {
  const query = req.query as Record<string, unknown>;
  const provided = req.headers["x-webhook-secret"] ?? query.secret;
  if (provided !== env.VIDEO_WEBHOOK_SECRET) {
    throw new AppError(401, "Invalid webhook secret");
  }
}

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live", async () => listLiveStreams());

  app.get<{ Params: { username: string } }>("/username/:username", async (req) =>
    getLiveStreamByUsername(req.params.username)
  );

  app.get("/creator-stats", { preHandler: app.authenticate }, async (req) =>
    getCreatorStats(req.user.sub)
  );

  app.get<{ Params: { id: string } }>("/:id", async (req) => getStreamById(req.params.id));

  app.get<{ Params: { id: string } }>("/:id/activity", async (req) => getStreamActivity(req.params.id));

  app.get("/key", { preHandler: app.authenticate }, async (req) => getStreamKey(req.user.sub));

  app.post("/key/rotate", { preHandler: app.authenticate }, async (req) =>
    rotateStreamKey(req.user.sub)
  );

  app.post("/go-live", { preHandler: [app.authenticate, app.rejectIfBanned] }, async (req) => {
    const input = createStreamSchema.parse(req.body);
    return goLive(req.user.sub, input);
  });

  app.post("/end", { preHandler: app.authenticate }, async (req, reply) => {
    await endStream(req.user.sub);
    reply.send({ ok: true });
  });

  // SRS's own callback protocol (distinct from our usual {ok: true}
  // convention): the response body must be a JSON object with a "code"
  // field, 0 meaning success — {ok: true} alone gets parsed as "no code in
  // response" and SRS aborts the publish, even though the HTTP status is 200.
  app.post("/webhooks/live-started", async (req, reply) => {
    assertWebhookSecret(req);
    const input = srsCallbackSchema.parse(req.body);
    await markLiveByProviderStreamId(input.stream);
    reply.send({ code: 0 });
  });

  app.post("/webhooks/live-ended", async (req, reply) => {
    assertWebhookSecret(req);
    const input = srsCallbackSchema.parse(req.body);
    await markEndedByProviderStreamId(input.stream);
    reply.send({ code: 0 });
  });
};
