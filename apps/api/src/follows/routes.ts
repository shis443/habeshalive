import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getCategoryFollowStatus, toggleCategoryFollow } from "./category-service.js";
import { getFollowedCreators, getFollowStatus, listMyFollowers, toggleFollow } from "./service.js";

// Same keying rationale as wallet/routes.ts's keyByUser.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const followRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mine", { preHandler: app.authenticate }, async (req) => getFollowedCreators(req.user.sub));

  // Creator Dashboard's Community > Followers — deliberately a different
  // path from /mine above (that's "who I follow", this is "who follows
  // me"), not a query param on the same route, so the two can never be
  // confused by a caller forgetting to pass one.
  app.get("/followers", { preHandler: app.authenticate }, async (req) => listMyFollowers(req.user.sub));

  // Follower count is public; "am I following" is personalized when a valid
  // session is present and just defaults to false otherwise — so this route
  // intentionally doesn't require authentication.
  app.get<{ Params: { creatorId: string } }>("/:creatorId/status", async (req) => {
    let followerId: string | null = null;
    try {
      await req.jwtVerify();
      followerId = req.user.sub;
    } catch {
      // no/invalid session — treat as anonymous
    }
    return getFollowStatus(followerId, req.params.creatorId);
  });

  // Relied on the global 2000/min-per-IP default only (docs/SECURITY.md's
  // known-gaps list) — this is a real toggle a viewer might click quickly
  // by mistake, so this stays generous; it's a backstop against a
  // follow-bombing script, not something a real user could hit.
  app.post<{ Params: { creatorId: string } }>(
    "/:creatorId",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => toggleFollow(req.user.sub, req.params.creatorId)
  );

  // Phase 3.4 — category following. Registered under a static "category"
  // segment, same non-collision reasoning as "/mine"/"/followers" above:
  // "/category/:category/status" can't be shadowed by "/:creatorId/status"
  // regardless of registration order.
  app.get<{ Params: { category: string } }>("/category/:category/status", async (req) => {
    let followerId: string | null = null;
    try {
      await req.jwtVerify();
      followerId = req.user.sub;
    } catch {
      // no/invalid session — treat as anonymous
    }
    return getCategoryFollowStatus(followerId, req.params.category);
  });

  app.post<{ Params: { category: string } }>(
    "/category/:category",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => toggleCategoryFollow(req.user.sub, req.params.category)
  );
};
