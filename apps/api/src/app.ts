import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { adminRoutes } from "./admin/routes.js";
import { adRoutes } from "./ads/routes.js";
import { announcementRoutes } from "./announcements/routes.js";
import { authRoutes } from "./auth/routes.js";
import { avatarRoutes } from "./avatars/routes.js";
import { chatRoutes } from "./chat/routes.js";
import { env } from "./common/env.js";
import { AppError } from "./common/errors.js";
import { creatorApplicationRoutes } from "./creator-applications/routes.js";
import { followRoutes } from "./follows/routes.js";
import { giftCardRoutes } from "./gift-cards/routes.js";
import { httpRequestDuration, httpRequestsTotal, registry } from "./common/metrics.js";
import { pool } from "./common/db.js";
import { redis } from "./common/redis.js";
import { captureUnexpectedError } from "./common/sentry.js";
import { moderationRoutes } from "./moderation/routes.js";
import { notificationRoutes } from "./notifications/routes.js";
import { roleHasPermission, type PermissionKey } from "./common/rbac.js";
import { searchRoutes } from "./search/routes.js";
import { streamRoutes } from "./streams/routes.js";
import { whepRoutes } from "./streams/whep-routes.js";
import { subscriptionRoutes } from "./subscriptions/routes.js";
import { vodRoutes } from "./vods/routes.js";
import { walletRoutes } from "./wallet/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  // Explicit allowlist, not `origin: true` (reflects any Origin header) —
  // WEB_PUBLIC_URL is the one legitimate browser origin this API is ever
  // loaded from (see apps/web/lib/config.ts's API_BASE_URL, used by a
  // handful of client components that call this API directly rather than
  // through the /api/backend/* same-origin proxy).
  app.register(cors, { origin: [env.WEB_PUBLIC_URL] });
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

  // For public routes that personalize when a valid session is present
  // (e.g. filtering labeled content by the viewer's own preference) but
  // must keep working for anonymous visitors too.
  app.decorate("tryAuthenticate", async (req) => {
    try {
      await req.jwtVerify();
    } catch {
      // No token, or an invalid one — proceed unauthenticated.
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

  // role is embedded in the JWT at login (see auth/routes.ts's jwtSign),
  // but authorization here re-checks the live DB value instead of trusting
  // that claim — same live-lookup pattern as rejectIfBanned above, applied
  // to the same class of problem: a JWT can outlive the privilege it was
  // issued with. Without this, demoting an admin (or a moderator account
  // getting compromised and promoted back down) wouldn't actually revoke
  // access until that token's next expiry/refresh, which — since nothing
  // in this codebase forces re-login on role change — could be an
  // arbitrarily long window. Admin/mod routes are inherently low-traffic
  // (a human clicking around a dashboard, not a hot read path), so the
  // extra per-request query here isn't the tradeoff it would be on
  // something like GET /streams/live.
  //
  // Shared by requireAdmin/requireRole/requirePermission below — each
  // authenticates and re-reads the live role the same way, differing only
  // in what they do with it. Returns null (after already writing the 401
  // reply) if authentication itself failed, so callers can just check for
  // null and return early without duplicating the jwtVerify try/catch
  // three times.
  async function authenticateAndGetRole(
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply
  ): Promise<string | null> {
    try {
      await req.jwtVerify();
    } catch {
      reply.status(401).send({ error: "unauthorized" });
      return null;
    }
    const { rows } = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [req.user.sub]);
    return rows[0]?.role ?? null;
  }

  // db/migrations/0026_rbac_role_isolation.sql renames the old flat
  // 'admin' role to 'super_admin'. This app is deployed as two separate
  // processes (habeshalive on Fly, web on Vercel) that don't restart in
  // the same instant a migration commits, and the migration renames data
  // in place rather than adding 'super_admin' alongside a still-valid
  // 'admin' — so a version of this code that checked ONLY "super_admin"
  // would, deployed even slightly before the migration lands, correctly
  // reject every currently-real admin (their row still says 'admin'), and
  // deployed slightly after, would work. Rather than rely on getting that
  // race exactly right, both legacy 'admin' and the new 'super_admin' are
  // accepted here permanently — cheap, permanent insurance against this
  // exact class of deploy-ordering bug, not a temporary shim meant to be
  // deleted later. See docs/rbac-and-moderation-testing.md for how this
  // was verified.
  const SUPER_ADMIN_ROLES = ["super_admin", "admin"];

  app.decorate("requireAdmin", async (req, reply) => {
    const role = await authenticateAndGetRole(req, reply);
    if (role === null) return;
    if (!SUPER_ADMIN_ROLES.includes(role)) {
      reply.status(403).send({ error: "forbidden" });
    }
  });

  // Parameterized version of requireAdmin — for routes that should admit
  // more than one specific role (e.g. both super_admin and moderator) but
  // still not everyone. A factory, not a fixed preHandler, since which
  // roles are allowed varies per route: use as
  // `preHandler: app.requireRole(["super_admin", "moderator"])`. If
  // "super_admin" is in the allowed list, legacy "admin" is silently
  // accepted too — same reasoning as requireAdmin above.
  app.decorate("requireRole", (allowedRoles: string[]) => {
    const normalized = allowedRoles.includes("super_admin")
      ? [...allowedRoles, "admin"]
      : allowedRoles;
    return async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      const role = await authenticateAndGetRole(req, reply);
      if (role === null) return;
      if (!normalized.includes(role)) {
        reply.status(403).send({ error: "forbidden" });
      }
    };
  });

  // The genuinely fine-grained check: gates on a specific, namespaced
  // *capability* (db/migrations/0027_permission_grants.sql's
  // role_permission_grants table) rather than an explicit role list, so
  // a route asking "can this caller audit financial data" doesn't need
  // to know or maintain which roles currently happen to grant that —
  // e.g. `preHandler: app.requirePermission("finance:audit")` admits
  // both finance_auditor and super_admin today without either being
  // named at the route, and stays correct if the grant set for a role
  // ever changes (a role_permission_grants data change, not a code
  // change at every call site). No legacy-'admin' role-name fallback
  // needed here the way requireAdmin/requireRole have one —
  // role_permission_grants is seeded with 'super_admin' from the start,
  // not 'admin'. What this DOES need to tolerate is the table not
  // existing yet in the brief window between this code deploying and
  // migration 0027 landing — see rbac.ts's roleHasPermission for the
  // fail-closed handling of that.
  app.decorate("requirePermission", (permission: PermissionKey) => {
    return async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      const role = await authenticateAndGetRole(req, reply);
      if (role === null) return;
      if (!(await roleHasPermission(role, permission))) {
        reply.status(403).send({ error: "forbidden" });
      }
    };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: "validation_error", issues: err.issues });
      return;
    }
    if (err instanceof AppError) {
      captureUnexpectedError(err);
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
    captureUnexpectedError(err);
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
  app.register(announcementRoutes, { prefix: "/announcements" });
  app.register(avatarRoutes, { prefix: "/avatars" });
  app.register(chatRoutes, { prefix: "/chat" });
  app.register(followRoutes, { prefix: "/follows" });
  app.register(creatorApplicationRoutes, { prefix: "/creator-applications" });
  app.register(adRoutes, { prefix: "/ads" });
  app.register(giftCardRoutes, { prefix: "/gift-cards" });
  app.register(streamRoutes, { prefix: "/streams" });
  app.register(whepRoutes, { prefix: "/streams" });
  app.register(walletRoutes, { prefix: "/wallet" });
  app.register(moderationRoutes, { prefix: "/moderation" });
  app.register(notificationRoutes, { prefix: "/notifications" });
  app.register(searchRoutes, { prefix: "/search" });
  app.register(adminRoutes, { prefix: "/admin" });
  app.register(subscriptionRoutes, { prefix: "/subscriptions" });
  app.register(vodRoutes, { prefix: "/vods" });

  return app;
}
