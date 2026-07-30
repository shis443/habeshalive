import { z } from "zod";

export const giftTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceSantim: z.number().int().positive(),
  animationKey: z.string(),
});
export type GiftType = z.infer<typeof giftTypeSchema>;

// quantity caps at 100, not 999 — the "custom quantity, maximum cap" the
// Gursha modal asks for. At the 2500 santim (25 ETB) base unit price (see
// db/migrations/0019_gursha.sql), 100 is 2500 ETB, already a real amount
// of money; letting it go to 999 (24,975 ETB) the way the old generic gift
// system did isn't a real safeguard.
export const sendGiftSchema = z.object({
  streamId: z.string().uuid(),
  giftTypeId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
  message: z.string().max(200).optional(),
  // Dedication, not a money split — the creator (from streamId) is always
  // who's actually paid, same 3-leg ledger as before. recipientId is
  // purely who the gift is publicly attributed to ("gifted in honor of
  // @username") when set; omitted means "to the Community."
  recipientId: z.string().uuid().optional(),
  isAnonymous: z.boolean().optional(),
});
export type SendGiftInput = z.infer<typeof sendGiftSchema>;

export const gifterBadgeTierSchema = z.enum(["none", "bronze", "silver", "gold", "platinum"]);
export type GifterBadgeTier = z.infer<typeof gifterBadgeTierSchema>;

export const gifterBadgeSchema = z.object({
  creatorId: z.string().uuid(),
  totalGurshaSantim: z.number().int(),
  tier: gifterBadgeTierSchema,
  // Client-side progress-bar math needs to know both ends of the current
  // band without hardcoding the threshold table twice.
  nextTierThresholdSantim: z.number().int().nullable(),
});
export type GifterBadge = z.infer<typeof gifterBadgeSchema>;

export const sendGiftResponseSchema = z.object({
  id: z.string().uuid(),
  badge: gifterBadgeSchema,
});
export type SendGiftResponse = z.infer<typeof sendGiftResponseSchema>;

// Published to Centrifugo channel `gift-alerts:<streamId>` (see
// apps/api/src/wallet/service.ts) so a live stream's overlay/alert widget
// can react to a gift in realtime, the same way chatMessageSchema events
// flow over `stream-chat:<streamId>`. senderUsername/senderDisplayName are
// null when isAnonymous is true — the real sender is still recorded in
// gifts_sent (for moderation/badges/admin), anonymity only hides identity
// from what other viewers see over this channel and in chat.
export const giftAlertSchema = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderUsername: z.string().nullable(),
  senderDisplayName: z.string().nullable(),
  isAnonymous: z.boolean(),
  recipientUsername: z.string().nullable(),
  giftTypeId: z.string().uuid(),
  giftName: z.string(),
  animationKey: z.string(),
  quantity: z.number().int().positive(),
  totalSantim: z.number().int().positive(),
  message: z.string().max(200).nullable(),
  badgeTier: gifterBadgeTierSchema,
  createdAt: z.string(),
});
export type GiftAlert = z.infer<typeof giftAlertSchema>;

export const payoutMethodSchema = z.enum(["telebirr", "bank"]);
export type PayoutMethod = z.infer<typeof payoutMethodSchema>;

export const requestPayoutSchema = z
  .object({
    amountSantim: z.coerce.number().int().positive(),
    method: payoutMethodSchema,
    destination: z.string().min(3).max(120),
    // Chapa's transfer API needs a bank_code to know which bank the
    // account number belongs to (GET /v1/banks) — required for "bank"
    // payouts since a raw account number alone doesn't identify it;
    // "telebirr" resolves its own bank_code by name lookup server-side.
    bankCode: z.string().min(1).optional(),
  })
  .refine((input) => input.method !== "bank" || !!input.bankCode, {
    message: "bankCode is required for bank payouts",
    path: ["bankCode"],
  });
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const payoutStatusSchema = z.enum(["pending_review", "processing", "paid", "failed"]);

export const payoutQueueItemSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  amountSantim: z.number().int(),
  method: payoutMethodSchema,
  destination: z.string(),
  status: payoutStatusSchema,
  createdAt: z.string(),
});
export type PayoutQueueItem = z.infer<typeof payoutQueueItemSchema>;

export const payoutResponseSchema = z.object({
  id: z.string().uuid(),
  amountSantim: z.number().int(),
  status: payoutStatusSchema,
  requiresManualApproval: z.boolean(),
});
export type PayoutResponse = z.infer<typeof payoutResponseSchema>;

// Chapa's transfer-status webhook — verified field names against
// https://developer.chapa.co/docs/webhooks (2026-07-22) "Payout webhook".
export const chapaTransferWebhookSchema = z.object({
  type: z.literal("Payout"),
  reference: z.string(),
  chapa_reference: z.string().optional(),
  status: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
});
export type ChapaTransferWebhook = z.infer<typeof chapaTransferWebhookSchema>;

export const initiateTopupSchema = z.object({
  amountSantim: z.coerce.number().int().positive(),
});
export type InitiateTopupInput = z.infer<typeof initiateTopupSchema>;

export const topupResponseSchema = z.object({
  reference: z.string(),
  checkoutUrl: z.string(),
});
export type TopupResponse = z.infer<typeof topupResponseSchema>;

export const walletBalanceSchema = z.object({
  balanceSantim: z.coerce.number().int(),
  weeklyDeltaSantim: z.coerce.number().int(),
  updatedAt: z.string(),
});
export type WalletBalance = z.infer<typeof walletBalanceSchema>;

export const earningsThisMonthSchema = z.object({
  amountSantim: z.coerce.number().int(),
});
export type EarningsThisMonth = z.infer<typeof earningsThisMonthSchema>;

export const chapaWebhookSchema = z.object({
  tx_ref: z.string(),
  status: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
});
export type ChapaWebhook = z.infer<typeof chapaWebhookSchema>;

export const ledgerTransactionTypeSchema = z.enum([
  "topup",
  "gift",
  "payout",
  "refund",
  "adjustment",
  "subscription",
  "boost",
]);

export const transactionSchema = z.object({
  id: z.string().uuid(),
  type: ledgerTransactionTypeSchema,
  status: z.enum(["pending", "completed", "failed", "reversed"]),
  title: z.string(),
  amountSantim: z.number().int(),
  direction: z.enum(["credit", "debit"]),
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof transactionSchema>;
