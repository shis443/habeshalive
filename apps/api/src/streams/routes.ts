import { createStreamSchema, srsCallbackSchema, srsDvrCallbackSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getBoostPricing } from "../admin/config-service.js";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import { createVodFromRecording } from "../vods/service.js";
import {
  boostStream,
  endStream,
  getCreatorStats,
  getLiveStreamByUsername,
  getMostRecentStreamIdByProviderStreamId,
  getStreamActivity,
  getStreamById,
  getStreamDefaults,
  getStreamKey,
  goLive,
  listLiveStreams,
  markEndedByProviderStreamId,
  markLiveByProviderStreamId,
  rotateStreamKey,
  thumbnailPlaceholderSvg,
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

// Same per-user keying as wallet/routes.ts's keyByUser (each route file
// defines its own — not shared — see that file's comment for why the
// preHandler hook matters here too).
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { category?: string } }>(
    "/live",
    { preHandler: app.tryAuthenticate },
    async (req) => listLiveStreams(req.query.category, req.user?.sub)
  );

  app.get("/defaults", { preHandler: app.authenticate }, async (req) => getStreamDefaults(req.user.sub));

  // Public read of just the price/duration — the actual admin-editable
  // config lives behind /admin/config, this is only what the go-live
  // panel needs to show before a creator clicks Boost, so the displayed
  // price can never drift from what actually gets charged.
  app.get("/boost-price", async () => getBoostPricing());

  // Public, unauthenticated — this is an <img src>, same as any other
  // stream thumbnail. No caching headers: category placeholders are cheap
  // to regenerate and correctness (a fresh category rendering immediately)
  // matters more than shaving a near-instant SVG render.
  app.get<{ Params: { category: string } }>("/thumbnail-placeholder/:category", async (req, reply) => {
    const category = req.params.category.replace(/\.svg$/, "");
    reply.header("Content-Type", "image/svg+xml").send(thumbnailPlaceholderSvg(decodeURIComponent(category)));
  });

  app.get<{ Params: { username: string } }>(
    "/username/:username",
    { preHandler: app.tryAuthenticate },
    async (req) => getLiveStreamByUsername(req.params.username, req.user?.sub)
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

  app.post(
    "/boost",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 5, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => boostStream(req.user.sub)
  );

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

  // NOT YET REACHABLE IN PRODUCTION: SRS has no dvr{} block or on_dvr hook
  // configured (see infra/srs/conf/srs.conf.template) — recording isn't
  // enabled, so this callback never fires today. createVodFromRecording()
  // itself is real and works against any reachable file URL; what's
  // missing is (a) enabling SRS's dvr{} recording, (b) adding
  // `on_dvr __API_WEBHOOK_BASE__/streams/webhooks/vod-ready?secret=...` to
  // http_hooks, and (c) real VOD_S3_* credentials (see common/env.ts) —
  // none of which this pass touches, since it means redeploying the live
  // SRS ingest service with no credentials on hand to verify against.
  app.post("/webhooks/vod-ready", async (req, reply) => {
    assertWebhookSecret(req);
    const input = srsDvrCallbackSchema.parse(req.body);
    const streamId = await getMostRecentStreamIdByProviderStreamId(input.stream);
    if (!streamId) throw new AppError(404, "Unknown provider stream id");
    // SRS's on_dvr sends a local filesystem path (`file`); this assumes
    // dvr_path is placed under http_server's served directory root
    // (./objs/nginx/html), same as HLS segments, so stripping that prefix
    // yields the URL path SRS already serves the file at.
    const urlPath = input.file.split("objs/nginx/html/")[1];
    if (!urlPath) throw new AppError(400, "Unexpected dvr file path shape");
    const fileUrl = `${env.SRS_HTTP_SCHEME}://${env.SRS_HTTP_HOST}/${urlPath}`;
    await createVodFromRecording(streamId, fileUrl);
    reply.send({ code: 0 });
  });
};
