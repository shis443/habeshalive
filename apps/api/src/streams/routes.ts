import { createStreamSchema, srsCallbackSchema, srsDvrCallbackSchema } from "@habeshalive/shared";
import { timingSafeEqual } from "node:crypto";
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
  getViewerList,
  goLive,
  listLiveStreams,
  markEndedByProviderStreamId,
  markLiveByProviderStreamId,
  rotateStreamKey,
  thumbnailPlaceholderSvg,
  type LiveStreamSort,
} from "./service.js";
import { purchasePpvAccess } from "./ppv-service.js";
import { searchTagNames } from "./tags-service.js";

// SRS's http_hooks can't send custom headers — only a fully-specified URL —
// so the secret travels as a query param there. Other callers (tests, any
// future provider that *can* send headers) can still use the header.
function assertWebhookSecret(req: FastifyRequest): void {
  const query = req.query as Record<string, unknown>;
  const provided = req.headers["x-webhook-secret"] ?? query.secret;
  // Constant-time compare, same reasoning as wallet/routes.ts's Chapa
  // signature check — a plain !== leaks timing information about how many
  // leading characters matched, in principle usable to brute-force the
  // secret byte-by-byte. Length-checked first since timingSafeEqual throws
  // on mismatched buffer lengths rather than returning false.
  if (typeof provided !== "string") throw new AppError(401, "Invalid webhook secret");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(env.VIDEO_WEBHOOK_SECRET);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new AppError(401, "Invalid webhook secret");
  }
}

// Same per-user keying as wallet/routes.ts's keyByUser (each route file
// defines its own — not shared — see that file's comment for why the
// preHandler hook matters here too).
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

// SRS's `param` field is the raw query string appended to the RTMP/WHIP
// stream name (e.g. "?key=abc123"), forwarded verbatim from whatever the
// encoder published to. See srsCallbackSchema's comment for why the actual
// stream_key now travels here instead of as the stream name itself.
function extractKeyFromParam(param: string | undefined): string | null {
  if (!param) return null;
  const qs = param.startsWith("?") ? param.slice(1) : param;
  return new URLSearchParams(qs).get("key");
}

export const streamRoutes: FastifyPluginAsync = async (app) => {
  const VALID_SORTS = new Set<LiveStreamSort>(["viewers", "recent", "alphabetical"]);
  app.get<{ Querystring: { category?: string; language?: string; tag?: string; sort?: string } }>(
    "/live",
    { preHandler: app.tryAuthenticate },
    async (req) =>
      listLiveStreams({
        category: req.query.category,
        language: req.query.language,
        tag: req.query.tag,
        sort: VALID_SORTS.has(req.query.sort as LiveStreamSort) ? (req.query.sort as LiveStreamSort) : undefined,
        viewerId: req.user?.sub,
      })
  );

  app.get<{ Querystring: { q?: string } }>("/tags/search", async (req) => searchTagNames(req.query.q ?? ""));

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

  // ?ticket=<jwt>: an alternate proof of PPV access for the /embed/
  // [username] page — that page is our own Next.js route, but when
  // loaded inside a third-party <iframe> the viewer's session cookie
  // (SameSite=lax) typically isn't sent, so req.user?.sub above is often
  // undefined there even for a logged-in, already-purchased viewer. A
  // ticket minted by POST /:id/ppv/purchase carries the buyer's identity
  // directly instead. Re-checked against ppv_purchases by streamId+sub
  // (not trusted on the token's claims alone) via a second
  // getLiveStreamByUsername call — see common/fastify-jwt.d.ts's
  // PpvAccessClaims comment for why this is a distinct token type that
  // app.tryAuthenticate itself already refuses to treat as a session.
  app.get<{ Params: { username: string }; Querystring: { ticket?: string } }>(
    "/username/:username",
    { preHandler: app.tryAuthenticate },
    async (req) => {
      const stream = await getLiveStreamByUsername(req.params.username, req.user?.sub);
      if (stream.hasPpvAccess || !req.query.ticket) return stream;

      try {
        const decoded = app.jwt.verify<{ sub: string; streamId: string; ppvAccess?: boolean }>(req.query.ticket);
        if (decoded.ppvAccess === true && decoded.streamId === stream.id) {
          return await getLiveStreamByUsername(req.params.username, decoded.sub);
        }
      } catch {
        // Invalid/expired ticket — fall through, stream stays gated.
      }
      return stream;
    }
  );

  app.get("/creator-stats", { preHandler: app.authenticate }, async (req) =>
    getCreatorStats(req.user.sub)
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: app.tryAuthenticate },
    async (req) => getStreamById(req.params.id, req.user?.sub)
  );

  app.get<{ Params: { id: string } }>("/:id/activity", async (req) => getStreamActivity(req.params.id));

  app.get<{ Params: { id: string } }>("/:id/viewers", async (req) => getViewerList(req.params.id));

  // Module 2 — PPV purchase. Charges the buyer's wallet balance
  // (purchasePpvAccess) then issues a short-lived, stream-and-buyer-scoped
  // JWT — see common/fastify-jwt.d.ts's PpvAccessClaims comment for why
  // this token type exists distinctly from a real session token. Every
  // call after the first one for the same (streamId, buyerId) is a free
  // no-op re-issue (purchasePpvAccess itself is idempotent), so a client
  // that lost its token can just call this again rather than needing a
  // separate "reissue my ticket" endpoint.
  app.post<{ Params: { id: string } }>(
    "/:id/ppv/purchase",
    { preHandler: [app.authenticate, app.rejectIfBanned] },
    async (req, reply) => {
      const { jti } = await purchasePpvAccess(req.user.sub, req.params.id);
      const accessToken = await reply.jwtSign(
        { sub: req.user.sub, streamId: req.params.id, ppvAccess: true, jti },
        { expiresIn: "24h" }
      );
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      reply.send({ accessToken, expiresAt });
    }
  );

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
    await markLiveByProviderStreamId(input.stream, extractKeyFromParam(input.param));
    reply.send({ code: 0 });
  });

  app.post("/webhooks/live-ended", async (req, reply) => {
    assertWebhookSecret(req);
    const input = srsCallbackSchema.parse(req.body);
    await markEndedByProviderStreamId(input.stream, extractKeyFromParam(input.param));
    reply.send({ code: 0 });
  });

  // SRS's dvr{} block (infra/srs/conf/srs.conf.template) and this hook are
  // now both configured — see that file's own comment for the full story.
  // STILL BLOCKED ON: real VOD_S3_* credentials (common/env.ts) — without
  // them, uploadObject() inside createVodFromRecording() throws "Object
  // storage is not configured" and this webhook 500s. That's the one
  // remaining piece nobody but a human with real bucket credentials can
  // provide; see docs/vod-recording-rollout.md.
  app.post("/webhooks/vod-ready", async (req, reply) => {
    assertWebhookSecret(req);
    const input = srsDvrCallbackSchema.parse(req.body);
    const streamId = await getMostRecentStreamIdByProviderStreamId(input.stream);
    if (!streamId) throw new AppError(404, "Unknown provider stream id");
    // SRS's on_dvr sends a local filesystem path (`file`, e.g.
    // ".../objs/dvr/<userId>/<timestamp>.mp4"), not a URL — this API can't
    // read it directly (separate machine, no shared filesystem), so it has
    // to be turned into a URL apps/api can fetch. Deliberately built from
    // SRS_ADMIN_API_BASE (Fly's private 6PN, e.g.
    // http://habeshalive-srs.internal:1985) rather than the public
    // SRS_HTTP_SCHEME/SRS_HTTP_HOST pair the old version of this route
    // used — dvr_path was moved outside http_server's publicly-served
    // ./objs/nginx/html root specifically so recordings are never
    // reachable over the public internet at all (see srs.conf.template's
    // dvr{} comment for the full reasoning); whip-proxy.nginx.conf's
    // internal-only IPv6 listener gained a matching /dvr/ static-file
    // location to serve them only over this private path instead.
    const urlPath = input.file.split("objs/dvr/")[1];
    if (!urlPath) throw new AppError(400, "Unexpected dvr file path shape");
    const fileUrl = `${env.SRS_ADMIN_API_BASE}/dvr/${urlPath}`;
    await createVodFromRecording(streamId, fileUrl);
    reply.send({ code: 0 });
  });
};
