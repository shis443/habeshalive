import { kycIdTypeSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../common/errors.js";
import { getMyKycStatus, submitKyc } from "./service.js";

export const kycRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", { preHandler: app.authenticate }, async (req) => getMyKycStatus(req.user.sub));

  // multipart/form-data: an "idType" field ("fayda" | "kebele") plus a
  // "document" file field (JPEG/PNG/PDF, see kyc/service.ts's
  // ALLOWED_CONTENT_TYPES) — req.file() parses both in one pass since
  // @fastify/multipart attaches every sibling field it saw onto the
  // returned file's .fields, not just the file itself.
  app.post("/submit", { preHandler: [app.authenticate, app.rejectIfBanned] }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw new AppError(400, "No file uploaded");

    const idTypeField = file.fields.idType;
    const idTypeValue =
      idTypeField && !Array.isArray(idTypeField) && idTypeField.type === "field" ? idTypeField.value : undefined;
    const idType = kycIdTypeSchema.parse(idTypeValue);

    const buffer = await file.toBuffer();
    await submitKyc(req.user.sub, idType, { buffer, contentType: file.mimetype });
    reply.send({ ok: true });
  });
};
