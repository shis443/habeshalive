import type { FastifyPluginAsync } from "fastify";
import { getFollowedCreators, getFollowStatus, listMyFollowers, toggleFollow } from "./service.js";

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

  app.post<{ Params: { creatorId: string } }>(
    "/:creatorId",
    { preHandler: app.authenticate },
    async (req) => toggleFollow(req.user.sub, req.params.creatorId)
  );
};
