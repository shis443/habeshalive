import { z } from "zod";
import { giftTierKeySchema } from "./wallet.js";

export const adminSummarySchema = z.object({
  pendingPayouts: z.number().int(),
  pendingModerationFlags: z.number().int(),
  pendingReports: z.number().int(),
  pendingAppeals: z.number().int(),
  liveStreams: z.number().int(),
  totalUsers: z.number().int(),
  totalCreators: z.number().int(),
  giftVolumeSantim: z.number().int(),
  activeSubscriptions: z.number().int(),
  mrrSantim: z.number().int(),
  boostRevenueSantim: z.number().int(),
  todaySignups: z.number().int(),
  todayGiftVolumeSantim: z.number().int(),
});
export type AdminSummary = z.infer<typeof adminSummarySchema>;

export const rejectPayoutSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectPayoutInput = z.infer<typeof rejectPayoutSchema>;

export const payoutHistoryItemSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  amountSantim: z.number().int(),
  method: z.enum(["telebirr", "bank"]),
  destination: z.string(),
  status: z.enum(["pending_review", "processing", "paid", "failed"]),
  failureReason: z.string().nullable(),
  approvedByUsername: z.string().nullable(),
  rejectedByUsername: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type PayoutHistoryItem = z.infer<typeof payoutHistoryItemSchema>;

export const creatorPayoutContextSchema = z.object({
  totalLifetimePayoutsSantim: z.number().int(),
  accountCreatedAt: z.string(),
  pendingModerationFlags: z.number().int(),
});
export type CreatorPayoutContext = z.infer<typeof creatorPayoutContextSchema>;

export const blocklistTermSchema = z.object({
  id: z.string().uuid(),
  term: z.string(),
  // Module 5 — 'om' (Oromo), 'so' (Somali), 'am-latn' (Latin-
  // transliterated Amharic) added alongside the original 'en'/'am'.
  // scanText()'s matching (moderation/service.ts) was already
  // script-agnostic; this just admits more language tags for the
  // admin-curated term list itself.
  language: z.enum(["en", "am", "om", "so", "am-latn"]),
  addedByUsername: z.string().nullable(),
  createdAt: z.string(),
});
export type BlocklistTerm = z.infer<typeof blocklistTermSchema>;

export const addBlocklistTermSchema = z.object({
  term: z.string().min(1).max(100),
  // Module 5 — 'om' (Oromo), 'so' (Somali), 'am-latn' (Latin-
  // transliterated Amharic) added alongside the original 'en'/'am'.
  // scanText()'s matching (moderation/service.ts) was already
  // script-agnostic; this just admits more language tags for the
  // admin-curated term list itself.
  language: z.enum(["en", "am", "om", "so", "am-latn"]),
});
export type AddBlocklistTermInput = z.infer<typeof addBlocklistTermSchema>;

export const moderationActionRecordSchema = z.object({
  id: z.string().uuid(),
  actorUsername: z.string(),
  targetUsername: z.string(),
  action: z.enum(["delete_message", "timeout", "ban", "unban"]),
  reason: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  createdAt: z.string(),
});
export type ModerationActionRecord = z.infer<typeof moderationActionRecordSchema>;

export const forceEndStreamSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ForceEndStreamInput = z.infer<typeof forceEndStreamSchema>;

// Shared by the other stream_controls-backed emergency actions
// (mute/unmute chat, revoke ingest key) — same shape, same server-side
// enforcement (a route rejects an empty reason with 400, not just the UI).
export const streamControlReasonSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type StreamControlReasonInput = z.infer<typeof streamControlReasonSchema>;

export const streamArchiveItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: z.string().nullable(),
  creatorUsername: z.string(),
  peakViewers: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  vodId: z.string().uuid().nullable(),
});
export type StreamArchiveItem = z.infer<typeof streamArchiveItemSchema>;

export const ledgerReconciliationSchema = z.object({
  totalCreditsSantim: z.number().int(),
  totalDebitsSantim: z.number().int(),
  balanced: z.boolean(),
});
export type LedgerReconciliation = z.infer<typeof ledgerReconciliationSchema>;

export const platformWalletDaySchema = z.object({
  day: z.string(),
  netSantim: z.number().int(),
});

export const platformWalletSummarySchema = z.object({
  currentBalanceSantim: z.number().int(),
  last30Days: z.array(platformWalletDaySchema),
});
export type PlatformWalletSummary = z.infer<typeof platformWalletSummarySchema>;

export const ledgerEntryLookupSchema = z.object({
  id: z.string().uuid(),
  walletOwnerType: z.enum(["user", "platform"]),
  walletOwnerUsername: z.string().nullable(),
  direction: z.enum(["debit", "credit"]),
  amountSantim: z.number().int(),
});

export const ledgerTransactionLookupSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  reference: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  entries: z.array(ledgerEntryLookupSchema),
});
export type LedgerTransactionLookup = z.infer<typeof ledgerTransactionLookupSchema>;

export const manualAdjustmentSchema = z.object({
  targetUsername: z.string().min(1),
  amountSantim: z.number().int().positive(),
  direction: z.enum(["credit_user", "debit_user"]),
  reason: z.string().min(1).max(500),
  // T2's funding_bucket invariant (migration 0053) — defaults to
  // 'promotional' on the conservative side deliberately: an admin credit
  // is either a goodwill gesture (promotional, the honest default) or a
  // correction restoring real, already-settled revenue (paid, which an
  // admin who knows that must say explicitly). An under-specified admin
  // credit must never silently become spendable-and-withdrawable real
  // money. Meaningless for debit_user (a debit has nothing to bucket —
  // funding_bucket only exists on credits a wallet actually receives).
  fundingBucket: z.enum(["paid", "promotional"]).optional(),
});
export type ManualAdjustmentInput = z.infer<typeof manualAdjustmentSchema>;

export const adminAuditActionSchema = z.object({
  id: z.string().uuid(),
  actorUsername: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  // migration 0057. All four nullable because rows written before this
  // migration (or by a caller outside a real request, e.g. a background
  // job) genuinely have none of this — not because the column is optional
  // in spirit.
  actorIp: z.string().nullable(),
  actorSessionId: z.string().uuid().nullable(),
  beforeState: z.unknown().nullable(),
  afterState: z.unknown().nullable(),
});
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;

// --- Creators ---

export const creatorListItemSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  revenueShareBps: z.number().int(),
  isAnchorCreator: z.boolean(),
  isSuspended: z.boolean(),
  isVerified: z.boolean(),
  totalPayoutsSantim: z.number().int(),
  streamCount: z.number().int(),
  followerCount: z.number().int(),
});
export type CreatorListItem = z.infer<typeof creatorListItemSchema>;

export const updateCreatorSchema = z.object({
  revenueShareBps: z.number().int().min(0).max(10000).optional(),
  isAnchorCreator: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});
export type UpdateCreatorInput = z.infer<typeof updateCreatorSchema>;

export const suspendCreatorSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type SuspendCreatorInput = z.infer<typeof suspendCreatorSchema>;

// --- Users ---

export const userListItemSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  phoneNumber: z.string().nullable(),
  email: z.string().nullable(),
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" (the pre-0026 value) stays in this union permanently, not as
  // a temporary shim — apps/web/lib/api.ts's getCurrentUser() runtime-
  // validates against this schema via .parse(), so if it only listed the
  // post-migration roles, any account whose row still legitimately says
  // "admin" during the code-before-migration deploy window (see
  // apps/api/src/app.ts's requireAdmin comment for why that's the safer
  // order) would throw here — not just fail an admin-only check, but
  // crash getCurrentUser() outright, which is called on nearly every
  // page. Cheap, permanent insurance against that, same reasoning as the
  // backend's dual-role auth checks.
  role: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
  isBanned: z.boolean(),
  createdAt: z.string(),
  walletBalanceSantim: z.number().int(),
  giftsSentCount: z.number().int(),
  giftsSentSantim: z.number().int(),
});
export type UserListItem = z.infer<typeof userListItemSchema>;

export const updateUserRoleSchema = z.object({
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" (the pre-0026 value) stays in this union permanently, not as
  // a temporary shim — apps/web/lib/api.ts's getCurrentUser() runtime-
  // validates against this schema via .parse(), so if it only listed the
  // post-migration roles, any account whose row still legitimately says
  // "admin" during the code-before-migration deploy window (see
  // apps/api/src/app.ts's requireAdmin comment for why that's the safer
  // order) would throw here — not just fail an admin-only check, but
  // crash getCurrentUser() outright, which is called on nearly every
  // page. Cheap, permanent insurance against that, same reasoning as the
  // backend's dual-role auth checks.
  role: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

// --- Boosts ---

export const boostRevenueByCreatorSchema = z.object({
  creatorUsername: z.string(),
  boostCount: z.number().int(),
  totalSantim: z.number().int(),
});
export type BoostRevenueByCreator = z.infer<typeof boostRevenueByCreatorSchema>;

export const platformConfigSchema = z.object({
  boostPriceSantim: z.number().int(),
  boostDurationMs: z.number().int(),
  defaultRevenueShareBps: z.number().int(),
  payoutManualReviewThresholdSantim: z.number().int(),
  vodRetentionDaysDefault: z.number().int(),
  vodRetentionDaysAnchor: z.number().int(),
  approvedCreatorCap: z.number().int(),
  adRevenueShareBps: z.number().int(),
  adFrequencyCapPerHour: z.number().int(),
  giftCardExpiryMonths: z.number().int(),
  // Module 1.4 — see kyc/service.ts. Defaults false at the DB level
  // (0032_kyc.sql); an admin opts in from Admin Settings once the review
  // queue is actually staffed, rather than this shipping hard-on and
  // instantly blocking every existing creator's payouts.
  kycRequiredForPayouts: z.boolean(),
  updatedAt: z.string(),
  updatedByUsername: z.string().nullable(),
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const updatePlatformConfigSchema = z.object({
  boostPriceSantim: z.number().int().positive(),
  boostDurationMs: z.number().int().positive(),
  defaultRevenueShareBps: z.number().int().min(0).max(10000),
  payoutManualReviewThresholdSantim: z.number().int().positive(),
  vodRetentionDaysDefault: z.number().int().positive(),
  vodRetentionDaysAnchor: z.number().int().positive(),
  approvedCreatorCap: z.number().int().positive(),
  adRevenueShareBps: z.number().int().min(0).max(10000),
  adFrequencyCapPerHour: z.number().int().positive(),
  giftCardExpiryMonths: z.number().int().positive(),
  kycRequiredForPayouts: z.boolean(),
});
export type UpdatePlatformConfigInput = z.infer<typeof updatePlatformConfigSchema>;

// --- Subscriptions ---

export const subscriptionAdminItemSchema = z.object({
  id: z.string().uuid(),
  subscriberUsername: z.string(),
  creatorUsername: z.string(),
  tierName: z.string(),
  priceSantim: z.number().int(),
  status: z.enum(["active", "cancelled", "expired", "payment_failed"]),
  expiresAt: z.string(),
});
export type SubscriptionAdminItem = z.infer<typeof subscriptionAdminItemSchema>;

export const extendGracePeriodSchema = z.object({
  days: z.number().int().min(1).max(30),
});
export type ExtendGracePeriodInput = z.infer<typeof extendGracePeriodSchema>;

// --- Anchor Creator Program ---
// No application/pipeline subsystem exists (there's no self-serve apply
// flow — creators reach out by email and the team follows up manually).
// This is a ranked view onto data that already exists elsewhere
// (lifetime earnings, tenure, stream activity) so an admin can see who's
// worth reaching out to; the actual promotion still happens through the
// existing isAnchorCreator toggle on the Creators page.
export const anchorCandidateSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  lifetimeEarningsSantim: z.number().int(),
  streamCount: z.number().int(),
  followerCount: z.number().int(),
  accountCreatedAt: z.string(),
});
export type AnchorCandidate = z.infer<typeof anchorCandidateSchema>;

// --- Stream tags (C.6) ---

export const streamTagAdminItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isBanned: z.boolean(),
  usageCount: z.number().int(),
  createdAt: z.string(),
});
export type StreamTagAdminItem = z.infer<typeof streamTagAdminItemSchema>;

export const mergeStreamTagsSchema = z.object({
  sourceTagId: z.string().uuid(),
  targetTagId: z.string().uuid(),
});
export type MergeStreamTagsInput = z.infer<typeof mergeStreamTagsSchema>;

// --- Gift catalog (T3) ---

// creatorShareBps here is a catalog-level REFERENCE value only — the
// actual creator/platform split on every send still comes from
// creator_profiles.revenue_share_bps (see db/migrations/0055's comment
// for why: the blueprint this table was drafted from assumed the split
// was a hardcoded constant, which this codebase's real split logic
// already isn't). Finance can tune this for planning/reporting; it does
// not change any real payout.
export const adminGiftTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceSantim: z.number().int().positive(),
  animationKey: z.string(),
  // Nullable: a handful of retired gift_types rows (e.g. "Golden Mulmul")
  // predate gift_tier_id being required and have it NULL — the admin
  // catalog must still show and let finance edit these, unlike the
  // viewer-facing catalog, which only ever lists is_active rows.
  tierKey: giftTierKeySchema.nullable(),
  isActive: z.boolean(),
  category: z.string(),
  creatorShareBps: z.number().int().min(0).max(10000),
  availableFrom: z.string().nullable(),
  availableUntil: z.string().nullable(),
  regions: z.array(z.string()).nullable(),
});
export type AdminGiftType = z.infer<typeof adminGiftTypeSchema>;

export const updateGiftTypeSchema = z.object({
  priceSantim: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  category: z.string().min(1).max(30).optional(),
  creatorShareBps: z.number().int().min(0).max(10000).optional(),
  // Explicit null clears the bound (always-available); omitted leaves it
  // unchanged; a string sets it.
  availableFrom: z.string().nullable().optional(),
  availableUntil: z.string().nullable().optional(),
  regions: z.array(z.string().length(2)).nullable().optional(),
  reason: z.string().min(1).max(500),
});
export type UpdateGiftTypeInput = z.infer<typeof updateGiftTypeSchema>;

// --- Analytics (T6) ---

export const leaderboardBoardSchema = z.enum([
  "top_gifters",
  "top_streamers_revenue",
  "top_streamers_watchtime",
  "top_streamers_ccu",
]);
export type LeaderboardBoardValue = z.infer<typeof leaderboardBoardSchema>;

export const leaderboardWindowKindSchema = z.enum(["daily", "weekly", "monthly", "alltime"]);
export type LeaderboardWindowKindValue = z.infer<typeof leaderboardWindowKindSchema>;

export const leaderboardRowSchema = z.object({
  subjectId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  rank: z.number().int().positive(),
  value: z.number().int(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const periodSummarySchema = z.object({
  grossSantim: z.number().int(),
  netSantim: z.number().int(),
  creatorShareSantim: z.number().int(),
  activeUsers: z.number().int(),
  payingUsers: z.number().int(),
  activeStreamers: z.number().int(),
  arpuSantim: z.number(),
  arppuSantim: z.number(),
  conversionPct: z.number(),
});
export type PeriodSummary = z.infer<typeof periodSummarySchema>;

export const revenueDailyPointSchema = z.object({
  day: z.string(),
  grossSantim: z.number().int(),
  netSantim: z.number().int(),
  activeUsers: z.number().int(),
  payingUsers: z.number().int(),
  activeStreamers: z.number().int(),
  arpuSantim: z.number(),
  arppuSantim: z.number(),
  conversionPct: z.number(),
});
export type RevenueDailyPoint = z.infer<typeof revenueDailyPointSchema>;

export const ccuCurvePointSchema = z.object({
  day: z.string(),
  peakViewers: z.number().int(),
});
export type CcuCurvePoint = z.infer<typeof ccuCurvePointSchema>;

export const analyticsOverviewSchema = z.object({
  current: periodSummarySchema,
  previous: periodSummarySchema,
  dailySeries: z.array(revenueDailyPointSchema),
  ccuCurve: z.array(ccuCurvePointSchema),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export const leaderboardQuerySchema = z.object({
  board: leaderboardBoardSchema,
  windowKind: leaderboardWindowKindSchema,
  windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "windowStart must be YYYY-MM-DD"),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const windowOptionSchema = z.object({
  windowKind: leaderboardWindowKindSchema,
  windowStart: z.string(),
  label: z.string(),
});
export type WindowOption = z.infer<typeof windowOptionSchema>;
