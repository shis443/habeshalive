import { redeemPointsSchema, watchHeartbeatSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getPointsBalance, recordWatchHeartbeat, redeemPoints } from "./service.js";

// User-keyed, same reasoning as wallet/routes.ts's keyByUser — this API
// is called server-to-server through apps/web's one fixed IP, so an
// IP-keyed limit would be one shared bucket for every viewer on the
// platform.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const pointsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/balance", { preHandler: app.authenticate }, async (req) => ({
    balance: await getPointsBalance(req.user.sub),
  }));

  // recordWatchHeartbeat's own DAILY_POINT_CAP is the real anti-farming
  // control (see points/service.ts) — this rate limit is just to bound
  // server load from a misbehaving client, not to prevent overpayment.
  // max: 6, not 2 — a viewer on a squad grid (Module 3, up to
  // MAX_SQUAD_SIZE=4 members) has that many VideoPlayer instances
  // mounted at once, each firing its own heartbeat within the same
  // ~60s window; 2/min would have wrongly 429'd most of a squad
  // viewer's genuine heartbeats.
  app.post(
    "/heartbeat",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 6, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = watchHeartbeatSchema.parse(req.body);
      return recordWatchHeartbeat(req.user.sub, input.streamId);
    }
  );

  app.post("/redeem", { preHandler: app.authenticate }, async (req) => {
    const input = redeemPointsSchema.parse(req.body);
    return redeemPoints(req.user.sub, input.points);
  });
};
