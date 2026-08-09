import { submitCreatorApplicationSchema } from "@birq/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getCapStatus, getMyApplication, submitApplication } from "./service.js";

// Same keying rationale as wallet/routes.ts's keyByUser — this route
// already requires app.authenticate, so req.user.sub is reliably set by
// the time the rate-limit plugin's preHandler-stage check runs.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

export const creatorApplicationRoutes: FastifyPluginAsync = async (app) => {
  // Relied on the global 2000/min-per-IP default only (docs/SECURITY.md's
  // known-gaps list) — a real applicant submits once; submitApplication
  // itself likely already rejects a duplicate, but this backstops a
  // scripted flood of application spam against the cap.
  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.rejectIfBanned],
      config: { rateLimit: { max: 5, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      const input = submitCreatorApplicationSchema.parse(req.body);
      return submitApplication(req.user.sub, input);
    }
  );

  app.get("/mine", { preHandler: app.authenticate }, async (req) => getMyApplication(req.user.sub));

  // Public — the application page shows "X of 100 spots filled" before a
  // viewer even signs up, same reasoning as /streams/boost-price being
  // public: real numbers the UI needs to display shouldn't require auth.
  app.get("/cap-status", async () => getCapStatus());
};
