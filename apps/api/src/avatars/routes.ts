import { saveAvatarSchema } from "@birq/shared";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../common/errors.js";
import {
  getAvatarPhoto,
  getUserSelection,
  listParts,
  randomizeSelection,
  renderUserAvatar,
  revertToGeneratedAvatar,
  saveSelection,
  uploadAvatarPhoto,
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

  // Module 5 — a real uploaded photo, alongside the generated avatar
  // above. multipart/form-data, single "photo" file field — no other
  // fields needed (see kyc/routes.ts for the pattern this mirrors).
  app.post("/photo", { preHandler: [app.authenticate, app.rejectIfBanned] }, async (req) => {
    const file = await req.file();
    if (!file) throw new AppError(400, "No file uploaded");
    const buffer = await file.toBuffer();
    return uploadAvatarPhoto(req.user.sub, buffer, file.mimetype);
  });

  // Public — the stable URL avatar_url points at after an upload; every
  // page that already renders <img src={avatarUrl}> keeps working
  // unauthenticated, same as /render/:userId.svg above.
  app.get<{ Params: { userId: string } }>("/photo/:userId", async (req, reply) => {
    const { buffer, contentType } = await getAvatarPhoto(req.params.userId);
    reply.header("Content-Type", contentType).header("Cache-Control", "public, max-age=300").send(buffer);
  });

  app.post("/photo/revert", { preHandler: app.authenticate }, async (req, reply) => {
    await revertToGeneratedAvatar(req.user.sub);
    reply.send({ ok: true });
  });
};
