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
