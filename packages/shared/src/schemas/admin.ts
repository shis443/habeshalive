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
  createdAt: z.string(),
});
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;
