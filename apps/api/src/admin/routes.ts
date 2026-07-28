import { forceEndStreamSchema, manualAdjustmentSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  forceEndStream,
  listAllLiveStreamsForAdmin,
  listStreamArchive,
} from "../streams/service.js";
import {
  getLedgerReconciliation,
  getPlatformWalletSummary,
  performManualAdjustment,
  searchLedgerTransaction,
} from "./ledger-service.js";
import { getAdminSummary, listActiveBoosts, listAdminActions } from "./service.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", { preHandler: app.requireAdmin }, async () => getAdminSummary());
  app.get("/boosts", { preHandler: app.requireAdmin }, async () => listActiveBoosts());
  app.get("/audit-log", { preHandler: app.requireAdmin }, async () => listAdminActions());

  app.get("/streams/live", { preHandler: app.requireAdmin }, async () => listAllLiveStreamsForAdmin());

  app.get<{ Querystring: { creator?: string } }>(
    "/streams/archive",
    { preHandler: app.requireAdmin },
    async (req) => listStreamArchive({ creatorUsername: req.query.creator })
  );

  app.post<{ Params: { id: string } }>("/streams/:id/force-end", { preHandler: app.requireAdmin }, async (req) => {
    const input = forceEndStreamSchema.parse(req.body);
    await forceEndStream(req.params.id, req.user.sub, input.reason);
    return { ok: true };
  });

  app.get("/ledger/reconciliation", { preHandler: app.requireAdmin }, async () => getLedgerReconciliation());

  app.get("/ledger/platform-wallet", { preHandler: app.requireAdmin }, async () => getPlatformWalletSummary());

  app.get<{ Querystring: { q?: string } }>(
    "/ledger/lookup",
    { preHandler: app.requireAdmin },
    async (req) => searchLedgerTransaction(req.query.q ?? "")
  );

  app.post("/ledger/adjustment", { preHandler: app.requireAdmin }, async (req) => {
    const input = manualAdjustmentSchema.parse(req.body);
    return performManualAdjustment(req.user.sub, input);
  });
};
