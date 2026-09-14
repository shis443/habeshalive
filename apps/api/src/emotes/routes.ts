import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../common/errors.js";
import {
  createEmote,
  deleteEmoteOwned,
  getApprovedEmoteCatalog,
  getEmoteImage,
  listMyEmotes,
} from "./service.js";

export const emoteRoutes: FastifyPluginAsync = async (app) => {
  // Public — every chat client builds its :code: lookup from this.
  app.get("/catalog", async () => getApprovedEmoteCatalog());

  app.get("/mine", { preHandler: app.authenticate }, async (req) => listMyEmotes(req.user.sub));

  // multipart/form-data: a "code" field plus an "image" file field — same
  // req.file()-with-.fields pattern as kyc/routes.ts's document submit.
  app.post("/", { preHandler: [app.authenticate, app.rejectIfBanned] }, async (req) => {
    const file = await req.file();
    if (!file) throw new AppError(400, "No file uploaded");

    const codeField = file.fields.code;
    const code = codeField && !Array.isArray(codeField) && codeField.type === "field" ? codeField.value : undefined;
    if (typeof code !== "string" || !code) throw new AppError(400, "An emote code is required");

    const buffer = await file.toBuffer();
    return createEmote(req.user.sub, code, buffer, file.mimetype);
  });

  // Public — the stable URL catalogEmoteSchema/emoteSchema's imageUrl
  // points at, same "proxy a private-storage read through apps/api's own
  // origin" pattern as avatars/routes.ts's /photo/:userId and
  // vods/clip-service.ts's OG-image route.
  app.get<{ Params: { id: string } }>("/:id/image", async (req, reply) => {
    const { buffer, contentType } = await getEmoteImage(req.params.id);
    reply
      .header("Content-Type", contentType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(buffer);
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: app.authenticate }, async (req, reply) => {
    await deleteEmoteOwned(req.params.id, req.user.sub);
    reply.status(204).send();
  });
};
