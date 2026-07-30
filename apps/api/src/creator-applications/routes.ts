import { submitCreatorApplicationSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { getCapStatus, getMyApplication, submitApplication } from "./service.js";

export const creatorApplicationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: [app.authenticate, app.rejectIfBanned] }, async (req) => {
    const input = submitCreatorApplicationSchema.parse(req.body);
    return submitApplication(req.user.sub, input);
  });

  app.get("/mine", { preHandler: app.authenticate }, async (req) => getMyApplication(req.user.sub));

  // Public — the application page shows "X of 100 spots filled" before a
  // viewer even signs up, same reasoning as /streams/boost-price being
  // public: real numbers the UI needs to display shouldn't require auth.
  app.get("/cap-status", async () => getCapStatus());
};
