import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { adminRoutes } from "./admin/routes.js";
import { authRoutes } from "./auth/routes.js";
import { avatarRoutes } from "./avatars/routes.js";
import { env } from "./common/env.js";
import { AppError } from "./common/errors.js";
import { followRoutes } from "./follows/routes.js";
import { httpRequestDuration, httpRequestsTotal, registry } from "./common/metrics.js";
import { pool } from "./common/db.js";
import { redis } from "./common/redis.js";
import { moderationRoutes } from "./moderation/routes.js";
import { searchRoutes } from "./search/routes.js";
import { streamRoutes } from "./streams/routes.js";
import { subscriptionRoutes } from "./subscriptions/routes.js";
import { walletRoutes } from "./wallet/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(jwt, { secret: env.JWT_SECRET });

  // Shared Redis-backed store (ioredis) so limits are enforced across all
  // API instances, not per-process — must be registered before the route
  // plugins below, since it hooks into route registration (onRoute) to
  // pick up each route's `config.rateLimit` override.
  //
  // This global default is IP-keyed and applies to every unauthenticated
  // read (streams/live, search, gift-types, the homepage's own data
  // fetches, ...) — a k6 load test caught that apps/web's Server
  // Components call this API server-to-server from the web container's
  // one fixed IP (see API_INTERNAL_URL in apps/web/lib/config.ts), so
  // EVERY visitor's page loads collectively share this one bucket, not
  // one bucket per visitor. 300/min (5 req/s) turned out to be too low
  // for that shared-IP reality — a 20-VU load test tripped it constantly
  // and briefly took the whole homepage down with real 500s (fixed
  // separately in apps/web/lib/api.ts: getLiveStreams/search now degrade
  // to an empty result on a non-200 instead of throwing and crashing the
  // page). 2000/min is a more realistic ceiling for that reality — this
  // number is now mainly a backstop against a runaway bug or scripted
  // abuse hitting the API directly, not a precise per-client throttle;
  // the routes that need real per-actor limits key on something more
  // meaningful than shared IP (OTP by phone number, gifts/topups/payouts
  // by authenticated user — see wallet/routes.ts's keyByUser and its
  // comment for why, and how it was verified to actually isolate buckets
  // per user rather than assumed).
  //
  // Fails open (skipOnError: true) — with this registered on every route,
  // a Redis blip would otherwise take the whole API down along with it.
  // The security-sensitive OTP routes below override skipOnError: false —
  // for those specifically, failing closed during a Redis outage is the
  // safer default than silently allowing unlimited OTP sends/brute force.
  app.register(rateLimit, {
    redis,
    nameSpace: "habeshalive-rl:",
    global: true,
    max: 2000,
    timeWindow: "1 minute",
    skipOnError: true,
  });

  app.decorate("authenticate", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.status(401).send({ error: "unauthorized" });
    }
  });

  // A separate preHandler, not folded into `authenticate` above: a banned
  // user still needs to authenticate successfully to reach
  // POST /moderation/appeals (the one thing they should still be able to
  // do) — rejecting bans inside `authenticate` itself would make that
  // route unreachable for exactly the users who need it. Apply this
  // explicitly on top of `authenticate` for the sensitive write routes
  // where a ban should actually bite: gifts, topups, payouts, go-live.
  app.decorate("rejectIfBanned", async (req, reply) => {
    const { rows } = await pool.query<{ is_banned: boolean }>(`SELECT is_banned FROM users WHERE id = $1`, [
      req.user.sub,
    ]);
    if (rows[0]?.is_banned) {
      reply.status(403).send({ error: "Your account is banned. Submit an appeal via POST /moderation/appeals." });
    }
  });

  // role is embedded in the JWT at login (see auth/routes.ts's jwtSign) —
  // no extra DB lookup needed, but it does mean a role change doesn't take
  // effect until the user's next login/token refresh.
  app.decorate("requireAdmin", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.status(401).send({ error: "unauthorized" });
      return;
    }
    if (req.user.role !== "admin") {
      reply.status(403).send({ error: "forbidden" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: "validation_error", issues: err.issues });
      return;
    }
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: err.message });
      return;
    }
    // Fastify-native errors (e.g. malformed body, bad content-type) already
    // carry the right client-error status — don't mask them as a 500.
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof err.statusCode === "number" &&
      err.statusCode >= 400 &&
      err.statusCode < 500
    ) {
      const message = "message" in err && typeof err.message === "string" ? err.message : "Bad request";
      reply.status(err.statusCode).send({ error: message });
      return;
    }
    req.log.error(err);
    reply.status(500).send({ error: "internal_server_error" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/metrics", async (req, reply) => {
    reply.header("content-type", registry.contentType);
    return registry.metrics();
  });

  // Route pattern (not raw URL) as the label — raw URLs carry IDs and would
  // blow up cardinality (one series per stream/user/etc).
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    const labels = { method: req.method, route, status_code: String(reply.statusCode) };
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    httpRequestsTotal.inc(labels);
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(avatarRoutes, { prefix: "/avatars" });
  app.register(followRoutes, { prefix: "/follows" });
  app.register(streamRoutes, { prefix: "/streams" });
  app.register(walletRoutes, { prefix: "/wallet" });
  app.register(moderationRoutes, { prefix: "/moderation" });
  app.register(searchRoutes, { prefix: "/search" });
  app.register(adminRoutes, { prefix: "/admin" });
  app.register(subscriptionRoutes, { prefix: "/subscriptions" });

  return app;
}
