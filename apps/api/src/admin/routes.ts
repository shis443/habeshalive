import {
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdvertiserSchema,
  createAnnouncementSchema,
  extendGracePeriodSchema,
  forceEndStreamSchema,
  manualAdjustmentSchema,
  mergeStreamTagsSchema,
  rejectCreatorApplicationSchema,
  suspendCreatorSchema,
  updateAdCampaignStatusSchema,
  updateAdLeadStatusSchema,
  updateCreatorSchema,
  updatePlatformConfigSchema,
  updateUserRoleSchema,
} from "@habeshalive/shared";
import {
  approveAdCreative,
  createAdCampaign,
  createAdCreative,
  createAdvertiser,
  getAdRevenueByCreator,
  listAdCampaigns,
  listAdCreatives,
  listAdLeads,
  listAdvertisers,
  updateAdCampaignStatus,
  updateAdLeadStatus,
} from "../ads/service.js";
import {
  cancelGiftCard,
  listGiftCardsAdmin,
  listSuspiciousGiftCardPurchasers,
} from "../gift-cards/service.js";
import { createAnnouncement, deactivateAnnouncement, listAnnouncementsAdmin } from "../announcements/service.js";
import { listTagsAdmin, mergeTags, setTagBanned } from "../streams/tags-service.js";
import type { FastifyPluginAsync } from "fastify";
import { forceEndStream, listAllLiveStreamsForAdmin, listStreamArchive } from "../streams/service.js";
import { listAnchorCandidates, listAnchorCreators } from "./anchor-service.js";
import {
  approveApplication,
  listApplications,
  rejectApplication,
} from "../creator-applications/service.js";
import {
  extendGracePeriod,
  forceCancelSubscription,
  listSubscriptionsForAdmin,
} from "../subscriptions/service.js";
import { cancelBoost, listBoostRevenueByCreator } from "./boosts-service.js";
import { getPlatformConfig, updatePlatformConfig } from "./config-service.js";
import { listCreators, suspendCreator, unsuspendCreator, updateCreator } from "./creators-service.js";
import {
  getLedgerReconciliation,
  getPlatformWalletSummary,
  performManualAdjustment,
  searchLedgerTransaction,
} from "./ledger-service.js";
import { getAdminSummary, listActiveBoosts, listAdminActions } from "./service.js";
import { listUsers, updateUserRole } from "./users-service.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", { preHandler: app.requireAdmin }, async () => getAdminSummary());
  app.get("/boosts", { preHandler: app.requireAdmin }, async () => listActiveBoosts());

  app.get<{ Querystring: { limit?: string; action?: string } }>(
    "/audit-log",
    { preHandler: app.requireAdmin },
    async (req) =>
      listAdminActions({
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        action: req.query.action,
      })
  );

  app.get("/anchor-program/creators", { preHandler: app.requireAdmin }, async () => listAnchorCreators());
  app.get("/anchor-program/candidates", { preHandler: app.requireAdmin }, async () => listAnchorCandidates());

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

  // --- Creators ---

  app.get<{ Querystring: { q?: string } }>(
    "/creators",
    { preHandler: app.requireAdmin },
    async (req) => listCreators(req.query.q)
  );

  app.patch<{ Params: { id: string } }>("/creators/:id", { preHandler: app.requireAdmin }, async (req) => {
    const input = updateCreatorSchema.parse(req.body);
    return updateCreator(req.user.sub, req.params.id, input);
  });

  app.post<{ Params: { id: string } }>("/creators/:id/suspend", { preHandler: app.requireAdmin }, async (req) => {
    const input = suspendCreatorSchema.parse(req.body);
    await suspendCreator(req.user.sub, req.params.id, input);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/creators/:id/unsuspend", { preHandler: app.requireAdmin }, async (req) => {
    await unsuspendCreator(req.user.sub, req.params.id);
    return { ok: true };
  });

  // --- Users ---

  app.get<{ Querystring: { q?: string } }>("/users", { preHandler: app.requireAdmin }, async (req) =>
    listUsers(req.query.q)
  );

  app.patch<{ Params: { id: string } }>("/users/:id/role", { preHandler: app.requireAdmin }, async (req) => {
    const input = updateUserRoleSchema.parse(req.body);
    return updateUserRole(req.user.sub, req.params.id, input);
  });

  // --- Boosts ---

  app.get("/boosts/revenue", { preHandler: app.requireAdmin }, async () => listBoostRevenueByCreator());

  app.post<{ Params: { id: string } }>("/boosts/:id/cancel", { preHandler: app.requireAdmin }, async (req) => {
    await cancelBoost(req.user.sub, req.params.id);
    return { ok: true };
  });

  app.get("/config", { preHandler: app.requireAdmin }, async () => getPlatformConfig());

  app.patch("/config", { preHandler: app.requireAdmin }, async (req) => {
    const input = updatePlatformConfigSchema.parse(req.body);
    return updatePlatformConfig(req.user.sub, input);
  });

  // --- Subscriptions ---

  app.get<{ Querystring: { atRisk?: string } }>(
    "/subscriptions",
    { preHandler: app.requireAdmin },
    async (req) => listSubscriptionsForAdmin({ atRisk: req.query.atRisk === "true" })
  );

  app.post<{ Params: { id: string } }>(
    "/subscriptions/:id/extend-grace",
    { preHandler: app.requireAdmin },
    async (req) => {
      const input = extendGracePeriodSchema.parse(req.body);
      await extendGracePeriod(req.user.sub, req.params.id, input.days);
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/subscriptions/:id/force-cancel",
    { preHandler: app.requireAdmin },
    async (req) => {
      await forceCancelSubscription(req.user.sub, req.params.id);
      return { ok: true };
    }
  );

  // --- Creator applications (A.4 launch gate) ---

  app.get<{ Querystring: { status?: "pending" | "approved" | "rejected" } }>(
    "/creator-applications",
    { preHandler: app.requireAdmin },
    async (req) => listApplications(req.query.status)
  );

  app.post<{ Params: { id: string } }>(
    "/creator-applications/:id/approve",
    { preHandler: app.requireAdmin },
    async (req) => {
      await approveApplication(req.user.sub, req.params.id);
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/creator-applications/:id/reject",
    { preHandler: app.requireAdmin },
    async (req) => {
      const input = rejectCreatorApplicationSchema.parse(req.body);
      await rejectApplication(req.user.sub, req.params.id, input.reason);
      return { ok: true };
    }
  );

  // --- Ads (B.2) ---

  app.get("/advertisers", { preHandler: app.requireAdmin }, async () => listAdvertisers());

  app.post("/advertisers", { preHandler: app.requireAdmin }, async (req) => {
    const input = createAdvertiserSchema.parse(req.body);
    return createAdvertiser(req.user.sub, input);
  });

  app.get("/ad-campaigns", { preHandler: app.requireAdmin }, async () => listAdCampaigns());

  app.post("/ad-campaigns", { preHandler: app.requireAdmin }, async (req) => {
    const input = createAdCampaignSchema.parse(req.body);
    return createAdCampaign(req.user.sub, input);
  });

  app.patch<{ Params: { id: string } }>("/ad-campaigns/:id/status", { preHandler: app.requireAdmin }, async (req) => {
    const input = updateAdCampaignStatusSchema.parse(req.body);
    await updateAdCampaignStatus(req.user.sub, req.params.id, input.status);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>(
    "/ad-campaigns/:id/creatives",
    { preHandler: app.requireAdmin },
    async (req) => listAdCreatives(req.params.id)
  );

  app.post("/ad-creatives", { preHandler: app.requireAdmin }, async (req) => {
    const input = createAdCreativeSchema.parse(req.body);
    return createAdCreative(req.user.sub, input);
  });

  app.post<{ Params: { id: string } }>(
    "/ad-creatives/:id/approve",
    { preHandler: app.requireAdmin },
    async (req) => {
      await approveAdCreative(req.user.sub, req.params.id);
      return { ok: true };
    }
  );

  app.get("/ad-leads", { preHandler: app.requireAdmin }, async () => listAdLeads());

  app.patch<{ Params: { id: string } }>("/ad-leads/:id/status", { preHandler: app.requireAdmin }, async (req) => {
    const input = updateAdLeadStatusSchema.parse(req.body);
    await updateAdLeadStatus(req.user.sub, req.params.id, input.status);
    return { ok: true };
  });

  app.get("/ad-revenue", { preHandler: app.requireAdmin }, async () => getAdRevenueByCreator());

  // --- Gift cards (B.3) ---

  app.get<{ Querystring: { status?: string } }>(
    "/gift-cards",
    { preHandler: app.requireAdmin },
    async (req) => listGiftCardsAdmin(req.query.status)
  );

  app.get("/gift-cards/suspicious", { preHandler: app.requireAdmin }, async () => listSuspiciousGiftCardPurchasers());

  app.post<{ Params: { id: string } }>("/gift-cards/:id/cancel", { preHandler: app.requireAdmin }, async (req) => {
    await cancelGiftCard(req.user.sub, req.params.id);
    return { ok: true };
  });

  // --- Stream tags (C.6) ---

  app.get("/stream-tags", { preHandler: app.requireAdmin }, async () => listTagsAdmin());

  app.post<{ Params: { id: string } }>("/stream-tags/:id/ban", { preHandler: app.requireAdmin }, async (req) => {
    await setTagBanned(req.user.sub, req.params.id, true);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/stream-tags/:id/unban", { preHandler: app.requireAdmin }, async (req) => {
    await setTagBanned(req.user.sub, req.params.id, false);
    return { ok: true };
  });

  app.post("/stream-tags/merge", { preHandler: app.requireAdmin }, async (req) => {
    const input = mergeStreamTagsSchema.parse(req.body);
    await mergeTags(req.user.sub, input.sourceTagId, input.targetTagId);
    return { ok: true };
  });

  // --- Announcements (D.2) ---

  app.get("/announcements", { preHandler: app.requireAdmin }, async () => listAnnouncementsAdmin());

  app.post("/announcements", { preHandler: app.requireAdmin }, async (req) => {
    const input = createAnnouncementSchema.parse(req.body);
    return createAnnouncement(req.user.sub, input);
  });

  app.post<{ Params: { id: string } }>(
    "/announcements/:id/deactivate",
    { preHandler: app.requireAdmin },
    async (req) => {
      await deactivateAnnouncement(req.user.sub, req.params.id);
      return { ok: true };
    }
  );
};
