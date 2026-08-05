import { z } from "zod";

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
  language: z.enum(["en", "am"]),
  addedByUsername: z.string().nullable(),
  createdAt: z.string(),
});
export type BlocklistTerm = z.infer<typeof blocklistTermSchema>;

export const addBlocklistTermSchema = z.object({
  term: z.string().min(1).max(100),
  language: z.enum(["en", "am"]),
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
