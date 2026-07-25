import type { FastifyPluginAsync } from "fastify";
import { getFollowedCreators, getFollowStatus, toggleFollow } from "./service.js";

export const followRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mine", { preHandler: app.authenticate }, async (req) => getFollowedCreators(req.user.sub));

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
