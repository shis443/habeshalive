import { z } from "zod";

// Gursha gift tiers (db/migrations/0025_gursha_gift_economy.sql) — each
// tier groups one or more themed gift_types at that tier's price. Kurt's
// "1000+ ETB" is reached via the existing quantity cap (see
// sendGiftSchema below), not a variable per-send amount.
export const giftTierKeySchema = z.enum(["mulmul", "buna", "tej", "kurt"]);
export type GiftTierKey = z.infer<typeof giftTierKeySchema>;

export const giftTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceSantim: z.number().int().positive(),
  animationKey: z.string(),
  tierKey: giftTierKeySchema,
});
export type GiftType = z.infer<typeof giftTypeSchema>;

export const giftTierSchema = z.object({
  key: giftTierKeySchema,
  displayName: z.string(),
  basePriceSantim: z.number().int().positive(),
  giftTypes: z.array(giftTypeSchema),
});
export type GiftTier = z.infer<typeof giftTierSchema>;

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

// Platform-wide prestige rank, distinct from gifterBadgeTier above
// (per-creator) — tracks cumulative Gursha spend across every creator.
// Named after historical Ethiopian military/administrative titles, low to
// high: Newari (default) -> Asir Aleka -> Meto Aleka -> Shi Aleka ->
// Dejazmach. See 0025_gursha_gift_economy.sql for the exact santim
// thresholds each one requires.
export const rankSchema = z.enum(["newari", "asir_aleka", "meto_aleka", "shi_aleka", "dejazmach"]);
export type Rank = z.infer<typeof rankSchema>;

export const userRankSchema = z.object({
  rank: rankSchema,
  totalGiftSpendSantim: z.number().int(),
  nextRankThresholdSantim: z.number().int().nullable(),
});
export type UserRank = z.infer<typeof userRankSchema>;

export const sendGiftResponseSchema = z.object({
  id: z.string().uuid(),
  badge: gifterBadgeSchema,
  rank: userRankSchema,
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
  // The sent gift's own tier (mulmul/buna/tej/kurt) — distinct from
  // badgeTier below, which is the *sender's* cumulative gifter-badge tier
  // for this creator. Previously missing here, so the alert overlay could
  // only scale intensity off totalSantim, not the actual tier bought (see
  // birq_stream_alert_banner.dart in the Flutter consumer app).
  giftTierKey: giftTierKeySchema,
  quantity: z.number().int().positive(),
  totalSantim: z.number().int().positive(),
  message: z.string().max(200).nullable(),
  badgeTier: gifterBadgeTierSchema,
  createdAt: z.string(),
});
export type GiftAlert = z.infer<typeof giftAlertSchema>;

// Free-form cash tip, distinct from sendGiftSchema's catalog-item shape
// (fixed price, quantity, animationKey) — a donor types in any amount.
// 500 santim (5 ETB) floor keeps this above Chapa/ledger rounding noise;
// no ceiling beyond the donor's actual wallet balance, checked server-side.
export const donateSchema = z.object({
  streamId: z.string().uuid(),
  amountSantim: z.number().int().min(500),
  message: z.string().max(200).optional(),
  isAnonymous: z.boolean().optional(),
});
export type DonateInput = z.infer<typeof donateSchema>;

export const donateResponseSchema = z.object({
  id: z.string().uuid(),
  badge: gifterBadgeSchema,
  rank: userRankSchema,
});
export type DonateResponse = z.infer<typeof donateResponseSchema>;

// Same live-overlay channel as giftAlertSchema (gift-alerts:<streamId>) —
// senderUsername/senderDisplayName null when isAnonymous, same convention.
export const donationAlertSchema = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  donorId: z.string().uuid(),
  donorUsername: z.string().nullable(),
  donorDisplayName: z.string().nullable(),
  isAnonymous: z.boolean(),
  amountSantim: z.number().int().positive(),
  message: z.string().max(200).nullable(),
  createdAt: z.string(),
});
export type DonationAlert = z.infer<typeof donationAlertSchema>;

// Both event kinds share one live-overlay channel/feed (a single on-stream
// alert box, not two) — "kind" disambiguates which shape a given message
// is, since donation and catalog-gift alerts don't carry the same fields.
export const streamAlertSchema = z.discriminatedUnion("kind", [
  giftAlertSchema.extend({ kind: z.literal("gift") }),
  donationAlertSchema.extend({ kind: z.literal("donation") }),
]);
export type StreamAlert = z.infer<typeof streamAlertSchema>;

// Module 2 — pay-per-view access to a single ticketed stream, purchased
// from wallet balance (same funding source as gifts/donations — see
// db/migrations/0033_donations_and_ppv.sql's own comment on why this
// isn't a separate direct-Chapa-checkout path). accessToken is a
// short-lived, stream-and-buyer-scoped JWT (apps/api/src/streams/
// ppv-service.ts) — see that file's comment on why "single-use" is
// enforced as "tied to one buyer+stream pair," not "expires after one
// HTTP request" (which would break continuous HLS playback).
export const purchasePpvAccessResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
});
export type PurchasePpvAccessResponse = z.infer<typeof purchasePpvAccessResponseSchema>;

export const payoutMethodSchema = z.enum(["telebirr", "bank"]);
export type PayoutMethod = z.infer<typeof payoutMethodSchema>;

// T7: a raw destination/bankCode typed on every request stored the
// creator's full account number as plaintext (payouts.destination) —
// closed by requiring a pre-bound, admin-verified payout_instrument
// instead. See db/migrations/0060's comment for why this replaced the
// original destination/bankCode fields rather than sitting alongside them.
export const requestPayoutSchema = z.object({
  amountSantim: z.coerce.number().int().positive(),
  instrumentId: z.string().uuid(),
});
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const payoutStatusSchema = z.enum([
  "pending_review",
  "approved",
  "processing",
  "paid",
  "rejected",
  "failed",
  "reversed",
]);

export const payoutQueueItemSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  amountSantim: z.number().int(),
  method: payoutMethodSchema,
  // The masked display value ("•••• 6789"), joined from the instrument —
  // never the raw account number, which no API response ever carries.
  instrumentDisplayTail: z.string().nullable(),
  status: payoutStatusSchema,
  createdAt: z.string(),
});
export type PayoutQueueItem = z.infer<typeof payoutQueueItemSchema>;

export const payoutInstrumentStatusSchema = z.enum(["unverified", "verified", "failed", "retired"]);

export const bindPayoutInstrumentSchema = z.object({
  method: payoutMethodSchema,
  accountNumber: z.string().min(4).max(60),
  accountHolder: z.string().min(1).max(120),
  bankCode: z.string().min(1).optional(),
});
export type BindPayoutInstrumentInput = z.infer<typeof bindPayoutInstrumentSchema>;

export const payoutInstrumentSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  method: payoutMethodSchema,
  displayTail: z.string(),
  accountHolder: z.string(),
  bankCode: z.string().nullable(),
  status: payoutInstrumentStatusSchema,
  usableFrom: z.string(),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type PayoutInstrument = z.infer<typeof payoutInstrumentSchema>;

// Same shape as payoutInstrumentSchema plus the creator's username — the
// admin review queue's own view, mirroring kyc.ts's kycAdminItemSchema
// (a plain PayoutInstrument has no way to identify whose it is).
export const payoutInstrumentAdminItemSchema = payoutInstrumentSchema.extend({
  username: z.string(),
});
export type PayoutInstrumentAdminItem = z.infer<typeof payoutInstrumentAdminItemSchema>;

export const taxResidencySchema = z.enum(["et_resident", "diaspora", "other"]);
export type TaxResidency = z.infer<typeof taxResidencySchema>;
export const taxFormTypeSchema = z.enum(["none", "w8ben", "w9"]);
export type TaxFormType = z.infer<typeof taxFormTypeSchema>;
export const taxProfileStatusSchema = z.enum(["pending", "verified", "rejected", "expired"]);
export type TaxProfileStatus = z.infer<typeof taxProfileStatusSchema>;

export const submitTaxProfileSchema = z.object({
  residency: taxResidencySchema,
  tin: z.string().min(1).max(20).optional(),
  formType: taxFormTypeSchema.optional(),
  formDocumentKey: z.string().optional(),
});
export type SubmitTaxProfileInput = z.infer<typeof submitTaxProfileSchema>;

export const taxProfileSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  residency: taxResidencySchema,
  tin: z.string().nullable(),
  formType: taxFormTypeSchema.nullable(),
  withholdingBps: z.number().int(),
  status: taxProfileStatusSchema,
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  createdAt: z.string(),
});
export type TaxProfile = z.infer<typeof taxProfileSchema>;

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

// Build 3 — SantimPay, a second local ETB rail alongside Chapa (both real,
// independent gateways with their own developer APIs — see
// diaspora-topup-service.ts's own comment on why Telebirr/CBE Birr/
// HelloCash don't get this same treatment). Defaults to "chapa" so every
// existing caller (web's AddFundsRow, mobile's wallet screen before this
// build) keeps working unchanged.
export const topupProviderSchema = z.enum(["chapa", "santimpay"]);
export type TopupProvider = z.infer<typeof topupProviderSchema>;

export const initiateTopupSchema = z.object({
  amountSantim: z.coerce.number().int().positive(),
  provider: topupProviderSchema.default("chapa"),
});
export type InitiateTopupInput = z.infer<typeof initiateTopupSchema>;

export const topupResponseSchema = z.object({
  reference: z.string(),
  checkoutUrl: z.string(),
});
export type TopupResponse = z.infer<typeof topupResponseSchema>;

// Module 2 diaspora bridge — international-card top-ups via Stripe/
// PayPal, for donors outside Ethiopia's mobile-money/bank-transfer
// network. See wallet/diaspora-topup-service.ts's own comment on why
// Telebirr/CBE Birr don't get an equivalent (already reachable through
// Chapa's existing hosted checkout). Shipped dormant — real
// STRIPE_SECRET_KEY/PAYPAL_CLIENT_ID/SECRET credentials aren't
// provisioned; the route 503s cleanly until they are.
export const diasporaProviderSchema = z.enum(["stripe", "paypal"]);
export type DiasporaProvider = z.infer<typeof diasporaProviderSchema>;

export const initiateDiasporaTopupSchema = z.object({
  amountUsdCents: z.coerce.number().int().positive(),
  provider: diasporaProviderSchema,
});
export type InitiateDiasporaTopupInput = z.infer<typeof initiateDiasporaTopupSchema>;

// Platform-wide sliding-scale ad-free subscription — distinct from the
// existing per-creator `subscriptions` (subscriptionTierSchema-adjacent
// code elsewhere): no creator_id, no revenue split, 100% platform
// revenue, same money shape as stream boosts.
export const platformSubscriptionStatusSchema = z.enum(["active", "cancelled", "expired", "payment_failed"]);
export type PlatformSubscriptionStatus = z.infer<typeof platformSubscriptionStatusSchema>;

// 150 ETB floor per the spec ("sliding scale... minimum 150 ETB/month,
// scaling up to 5,000+ ETB/month") — no ceiling enforced, matching "+".
export const PLATFORM_SUBSCRIPTION_MIN_SANTIM = 15000;

export const subscribeToPlatformSchema = z.object({
  amountSantim: z.coerce.number().int().min(PLATFORM_SUBSCRIPTION_MIN_SANTIM),
});
export type SubscribeToPlatformInput = z.infer<typeof subscribeToPlatformSchema>;

export const platformSubscriptionSchema = z.object({
  amountSantim: z.number().int(),
  status: platformSubscriptionStatusSchema,
  expiresAt: z.string(),
});
export type PlatformSubscription = z.infer<typeof platformSubscriptionSchema>;

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
  "platform_subscription",
  "donation",
  "ppv_purchase",
  "points_redemption",
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
