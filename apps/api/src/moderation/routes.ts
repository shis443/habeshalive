import {
  banUserSchema,
  resolveAppealSchema,
  resolveModerationFlagSchema,
  resolveReportSchema,
  submitAppealSchema,
  submitReportSchema,
  unbanUserSchema,
} from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { banUser, unbanUser } from "./actions-service.js";
import { listAppeals, resolveAppeal, submitAppeal } from "./appeals-service.js";
import { listReports, resolveReport, submitReport } from "./reports-service.js";
import { listModerationQueue, resolveModerationFlag } from "./service.js";

export const moderationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/queue", { preHandler: app.requireAdmin }, async () => listModerationQueue());

  app.post("/queue/:id/resolve", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const input = resolveModerationFlagSchema.parse(req.body);
    await resolveModerationFlag(id, req.user.sub, input.action);
    return { ok: true };
  });

  app.post("/reports", { preHandler: app.authenticate }, async (req) => {
    const input = submitReportSchema.parse(req.body);
    return submitReport(req.user.sub, input);
  });

  app.get("/reports", { preHandler: app.requireAdmin }, async () => listReports());

  app.post("/reports/:id/resolve", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const input = resolveReportSchema.parse(req.body);
    await resolveReport(id, req.user.sub, input);
    return { ok: true };
  });

  app.post("/actions/ban", { preHandler: app.requireAdmin }, async (req) => {
    const input = banUserSchema.parse(req.body);
    await banUser(req.user.sub, input.userId, input.reason);
    return { ok: true };
  });

  app.post("/actions/unban", { preHandler: app.requireAdmin }, async (req) => {
    const input = unbanUserSchema.parse(req.body);
    await unbanUser(req.user.sub, input.userId);
    return { ok: true };
  });

  app.post("/appeals", { preHandler: app.authenticate }, async (req) => {
    const input = submitAppealSchema.parse(req.body);
    return submitAppeal(req.user.sub, input.reason);
  });

  app.get("/appeals", { preHandler: app.requireAdmin }, async () => listAppeals());

  app.post("/appeals/:id/resolve", { preHandler: app.requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const input = resolveAppealSchema.parse(req.body);
    await resolveAppeal(id, req.user.sub, input.action);
    return { ok: true };
  });
};
