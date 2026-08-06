import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../common/errors.js";
import { getCreatorProfile } from "../follows/service.js";

// A tiny, standalone prefix rather than folding this into /follows —
// "look up a creator's public profile" isn't a follow-relationship
// concern, it just happens to reuse follows/service.ts's
// getCreatorProfile (which itself needs follow-count/is-following data,
// so the reuse is real, not just convenient naming).
export const creatorRoutes: FastifyPluginAsync = async (app) => {
  // Same manual jwtVerify try/catch as follows/routes.ts's
  // /:creatorId/status — public route, optional personalization
  // (isFollowing) when a valid session happens to be present.
  app.get<{ Params: { username: string } }>("/:username/profile", async (req) => {
    let viewerId: string | null = null;
    try {
      await req.jwtVerify();
      viewerId = req.user.sub;
    } catch {
      // no/invalid session — treat as anonymous
    }
    const profile = await getCreatorProfile(req.params.username, viewerId);
    if (!profile) throw new AppError(404, "Creator not found");
    return profile;
  });
};
