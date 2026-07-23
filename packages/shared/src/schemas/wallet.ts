import { z } from "zod";

export const giftTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceSantim: z.number().int().positive(),
  animationKey: z.string(),
});
export type GiftType = z.infer<typeof giftTypeSchema>;

export const sendGiftSchema = z.object({
  streamId: z.string().uuid(),
  giftTypeId: z.string().uuid(),
  quantity: z.number().int().positive().max(999),
  message: z.string().max(200).optional(),
});
export type SendGiftInput = z.infer<typeof sendGiftSchema>;

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
