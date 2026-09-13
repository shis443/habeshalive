import {
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdvertiserSchema,
  createAnnouncementSchema,
  createCategorySchema,
  extendGracePeriodSchema,
  forceEndStreamSchema,
  streamControlReasonSchema,
  manualAdjustmentSchema,
  mergeStreamTagsSchema,
  rejectCreatorApplicationSchema,
  rejectKycSchema,
  suspendCreatorSchema,
  updateAdCampaignStatusSchema,
  updateAdLeadStatusSchema,
  updateCategorySchema,
  updateCreatorSchema,
  updateGiftTypeSchema,
  updatePlatformConfigSchema,
  updateUserRoleSchema,
} from "@birq/shared";
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
import { createCategory, listCategoriesAdmin, updateCategory } from "../categories/service.js";
import { listTagsAdmin, mergeTags, setTagBanned } from "../streams/tags-service.js";
import type { FastifyPluginAsync } from "fastify";
import { forceEndStream, listAllLiveStreamsForAdmin, listStreamArchive } from "../streams/service.js";
import { adminRevokeIngestKey, muteStreamChat, unmuteStreamChat } from "../streams/emergency-controls-service.js";
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
import { approveKyc, getKycDocumentUrl, listKycSubmissions, rejectKyc } from "../kyc/service.js";
import { getPlatformConfig, updatePlatformConfig } from "./config-service.js";
import { listGiftTypesForAdmin, updateGiftType } from "./gift-catalog-service.js";
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

  app.get<{ Querystring: { limit?: string; action?: string; session?: string } }>(
    "/audit-log",
    { preHandler: app.requireAdmin },
    async (req) =>
      listAdminActions({
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        action: req.query.action,
        session: req.query.session,
      })
  );

  app.get("/anchor-program/creators", { preHandler: app.requireAdmin }, async () => listAnchorCreators());
  app.get("/anchor-program/candidates", { preHandler: app.requireAdmin }, async () => listAnchorCandidates());

  // Viewing live streams and force-ending one are the direct precursor
  // and the action itself for the same "publisher kick" workflow — both
  // db/migrations/0027_permission_grants.sql's 'stream:kick' permission,
  // not the general admin gate, so a moderator etc. isn't required to
  // hold full super_admin just to shut down an actively-abusive stream.
  app.get("/streams/live", { preHandler: app.requirePermission("stream:kick") }, async () => listAllLiveStreamsForAdmin());

  app.get<{ Querystring: { creator?: string } }>(
    "/streams/archive",
    { preHandler: app.requireAdmin },
    async (req) => listStreamArchive({ creatorUsername: req.query.creator })
  );

  app.post<{ Params: { id: string } }>(
    "/streams/:id/force-end",
    { preHandler: app.requirePermission("stream:kick") },
    async (req) => {
      const input = forceEndStreamSchema.parse(req.body);
      // Returns the enforcement result rather than a bare { ok: true }: the
      // client has to be able to tell "the publisher was dropped" from "we
      // recorded the request". forceEndStream throws 502 when the media
      // server could not confirm, so reaching here means enforced === true.
      const result = await forceEndStream(req.params.id, req.user.sub, input.reason);
      return { ok: true, enforced: result.enforced, killed: result.killed };
    }
  );

  // Chat mute/unmute is self-enforcing (chat/service.ts's sendChatMessage
  // reads stream_controls.chat_muted directly on every send) — there is no
  // external system to confirm against the way force-end's kill has, so
  // these two never throw 502 the way force-end can.
  app.post<{ Params: { id: string } }>(
    "/streams/:id/mute-chat",
    { preHandler: app.requirePermission("stream:kick") },
    async (req) => {
      const input = streamControlReasonSchema.parse(req.body);
      await muteStreamChat(req.user.sub, req.params.id, input.reason);
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/streams/:id/unmute-chat",
    { preHandler: app.requirePermission("stream:kick") },
    async (req) => {
      const input = streamControlReasonSchema.parse(req.body);
      await unmuteStreamChat(req.user.sub, req.params.id, input.reason);
      return { ok: true };
    }
  );

  // Wraps the creator's own rotateStreamKey with admin attribution — see
  // emergency-controls-service.ts's own comment on why this is logged as
  // "the rotation happened" rather than "the kill was confirmed": the
  // underlying teardown of any currently-open publish is best-effort by
  // design, same as banUser's.
  app.post<{ Params: { id: string } }>(
    "/streams/:id/revoke-ingest",
    { preHandler: app.requirePermission("stream:kick") },
    async (req) => {
      const input = streamControlReasonSchema.parse(req.body);
      await adminRevokeIngestKey(req.user.sub, req.params.id, input.reason);
      return { ok: true };
    }
  );

  // Read-only financial visibility — db/migrations/0027_permission_grants.sql's
  // 'finance:audit' permission, granted to finance_auditor as well as
  // super_admin.
  app.get("/ledger/reconciliation", { preHandler: app.requirePermission("finance:audit") }, async () => getLedgerReconciliation());

  app.get("/ledger/platform-wallet", { preHandler: app.requirePermission("finance:audit") }, async () => getPlatformWalletSummary());

  app.get<{ Querystring: { q?: string } }>(
    "/ledger/lookup",
    { preHandler: app.requirePermission("finance:audit") },
    async (req) => searchLedgerTransaction(req.query.q ?? "")
  );

  // Deliberately still requireAdmin (super_admin only), NOT
  // requirePermission("finance:audit") — this creates a real ledger
  // entry, not just reads one. Granting write access under the same
  // permission name as read-only "audit" would be a real privilege
  // escalation hiding behind an audit-sounding label — see
  // 0027_permission_grants.sql's own header for why finance_auditor is
  // deliberately never granted this.
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

  // Role management — explicitly requireRole(["super_admin"]) rather
  // than the general requireAdmin (they're currently equivalent, both
  // dual-compat with legacy 'admin' — see app.ts), because who is
  // allowed to grant/revoke roles is exactly the kind of check worth
  // being visibly explicit about at its own call site rather than
  // folded into the same generic gate used everywhere else in this file.
  app.patch<{ Params: { id: string } }>(
    "/users/:id/role",
    { preHandler: app.requireRole(["super_admin"]) },
    async (req) => {
      const input = updateUserRoleSchema.parse(req.body);
      return updateUserRole(req.user.sub, req.params.id, input);
    }
  );

  // --- Boosts ---

  app.get("/boosts/revenue", { preHandler: app.requirePermission("finance:audit") }, async () => listBoostRevenueByCreator());

  app.post<{ Params: { id: string } }>("/boosts/:id/cancel", { preHandler: app.requireAdmin }, async (req) => {
    await cancelBoost(req.user.sub, req.params.id);
    return { ok: true };
  });

  // System-wide settings — same explicit-requireRole reasoning as
  // /users/:id/role above.
  app.get("/config", { preHandler: app.requireRole(["super_admin"]) }, async () => getPlatformConfig());

  app.patch("/config", { preHandler: app.requireRole(["super_admin"]) }, async (req) => {
    const input = updatePlatformConfigSchema.parse(req.body);
    return updatePlatformConfig(req.user.sub, input);
  });

  // Gift catalog (T3) — same requireRole(["super_admin"]) as /config above,
  // for the same reason: this changes what viewers see and what a
  // catalog item's reference split/availability is, platform-wide.
  app.get("/gift-types", { preHandler: app.requireAdmin }, async () => listGiftTypesForAdmin());

  app.patch<{ Params: { id: string } }>(
    "/gift-types/:id",
    { preHandler: app.requireRole(["super_admin"]) },
    async (req) => {
      const input = updateGiftTypeSchema.parse(req.body);
      return updateGiftType(req.user.sub, req.params.id, input);
    }
  );

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

  // --- KYC (Module 1.4 — Fayda/Kebele ID review) ---

  app.get<{ Querystring: { status?: "pending" | "approved" | "rejected" } }>(
    "/kyc",
    { preHandler: app.requireAdmin },
    async (req) => listKycSubmissions(req.query.status)
  );

  // Short-lived signed URL, not the document itself proxied through this
  // JSON API — same reasoning as vods/routes.ts's playback URL endpoint.
  app.get<{ Params: { id: string } }>("/kyc/:id/document-url", { preHandler: app.requireAdmin }, async (req) => {
    return { url: await getKycDocumentUrl(req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/kyc/:id/approve", { preHandler: app.requireAdmin }, async (req) => {
    await approveKyc(req.user.sub, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/kyc/:id/reject", { preHandler: app.requireAdmin }, async (req) => {
    const input = rejectKycSchema.parse(req.body);
    await rejectKyc(req.user.sub, req.params.id, input.reason);
    return { ok: true };
  });

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

  app.get("/ad-revenue", { preHandler: app.requirePermission("finance:audit") }, async () => getAdRevenueByCreator());

  // --- Gift cards (B.3) ---

  app.get<{ Querystring: { status?: string } }>(
    "/gift-cards",
    { preHandler: app.requireAdmin },
    async (req) => listGiftCardsAdmin(req.query.status)
  );

  // Fraud/financial oversight — finance:audit, same reasoning as the
  // ledger/revenue routes above. gift-cards/:id/cancel below stays
  // requireAdmin: it's a mutation (voids a purchase), not a read.
  app.get(
    "/gift-cards/suspicious",
    { preHandler: app.requirePermission("finance:audit") },
    async () => listSuspiciousGiftCardPurchasers()
  );

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

  // --- Content categories (Flutter-reference UI rebuild) ---
  // Public reads live at categories/routes.ts (GET /categories,
  // GET /categories/:slug) — this is the write/manage surface only,
  // same split as every other admin-managed resource in this file.

  app.get("/categories", { preHandler: app.requireAdmin }, async () => listCategoriesAdmin());

  app.post("/categories", { preHandler: app.requireAdmin }, async (req) => {
    const input = createCategorySchema.parse(req.body);
    return createCategory(input);
  });

  app.patch<{ Params: { slug: string } }>("/categories/:slug", { preHandler: app.requireAdmin }, async (req) => {
    const input = updateCategorySchema.parse(req.body);
    return updateCategory(req.params.slug, input);
  });
};
