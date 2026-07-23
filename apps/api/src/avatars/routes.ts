import { saveAvatarSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  getUserSelection,
  listParts,
  randomizeSelection,
  renderUserAvatar,
  saveSelection,
} from "./service.js";

export const avatarRoutes: FastifyPluginAsync = async (app) => {
  app.get("/parts", async () => listParts());

  app.get("/randomize", async () => randomizeSelection());

  app.get("/me", { preHandler: app.authenticate }, async (req) => getUserSelection(req.user.sub));

  app.post("/save", { preHandler: app.authenticate }, async (req) => {
    const input = saveAvatarSchema.parse(req.body);
    return saveSelection(req.user.sub, input.selection);
  });

  app.get<{ Params: { userId: string } }>("/render/:userId.svg", async (req, reply) => {
    const svg = await renderUserAvatar(req.params.userId);
    reply.header("Content-Type", "image/svg+xml").send(svg);
  });
};
