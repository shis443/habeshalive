import { z } from "zod";
import { gifterBadgeTierSchema, rankSchema } from "./wallet.js";

export const sendChatMessageSchema = z.object({
  body: z.string().min(1).max(500),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  body: z.string(),
  // The sender's Gursha badge tier for THIS stream's creator specifically
  // (gifter_badges is scoped per-creator, see db/migrations/0019_gursha.sql)
  // — "none" means never gifted this creator, not "no badge system exists."
  gifterBadgeTier: gifterBadgeTierSchema,
  // Platform role at send time (live-joined against users.role, same
  // computed-not-stored pattern as gifterBadgeTier above — a later role
  // change doesn't rewrite history, it just changes what the next message
  // reflects).
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" stays permanently — see admin.ts's identical schema for the
  // full reasoning.
  senderRole: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
  // Whole months since subscriptions.started_at for an active subscription
  // to THIS stream's creator specifically; null if not subscribed.
  subscriberMonths: z.number().int().nullable(),
  // Platform-wide, unlike gifterBadgeTier/subscriberMonths above — the
  // sender's Rank (cumulative Gursha spend across every creator, see
  // user_ranks in 0025_gursha_gift_economy.sql) and whether they currently
  // hold an active platform-wide ad-free subscription. "newari" is the
  // default rank (never means "no rank system"), same non-null-default
  // convention gifterBadgeTier's "none" already uses.
  rank: rankSchema,
  hasSubShield: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatTokenSchema = z.object({
  token: z.string(),
});
export type ChatToken = z.infer<typeof chatTokenSchema>;

export const pinnedMessageSchema = z.object({
  message: chatMessageSchema,
  pinnedByUsername: z.string(),
  pinnedAt: z.string(),
});
export type PinnedMessage = z.infer<typeof pinnedMessageSchema>;

export const pinMessageSchema = z.object({
  messageId: z.string().uuid(),
});
export type PinMessageInput = z.infer<typeof pinMessageSchema>;

export const recentGifterSchema = z.object({
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  totalSantim: z.number().int(),
  isAnonymous: z.boolean(),
});
export type RecentGifter = z.infer<typeof recentGifterSchema>;
