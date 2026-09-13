import { z } from "zod";

export const adFormatSchema = z.enum(["preroll", "midroll", "display_banner", "sponsored_card", "overlay"]);
export type AdFormat = z.infer<typeof adFormatSchema>;

// --- Public / viewer-facing ---

// What a stream/browse page actually gets back to render — deliberately
// thin (no campaign internals, no advertiser id) since this is served to
// any viewer, including anonymous ones.
export const servedAdSchema = z.object({
  impressionId: z.string().uuid(),
  format: adFormatSchema,
  assetUrl: z.string(),
  clickUrl: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  advertiserName: z.string(),
});
export type ServedAd = z.infer<typeof servedAdSchema>;

// --- Two-slot video pre-roll (db/migrations/0063_preroll_ad_slots.sql) ---
// Skip behavior is a property of the SLOT (position in the break), not
// the creative or campaign — slot1 is always mandatory/unskippable, slot2
// is always skippable after platform_config.preroll_slot2_skip_after_seconds.

export const prerollSlotSchema = z.enum(["slot1", "slot2"]);
export type PrerollSlot = z.infer<typeof prerollSlotSchema>;

export const servedAdSlotSchema = servedAdSchema.extend({
  // null means "no skip allowed" (slot1); a number means "show a skip
  // control once this many seconds of THIS ad's own playback have
  // elapsed" (slot2).
  skippableAfterSeconds: z.number().int().nullable(),
});
export type ServedAdSlot = z.infer<typeof servedAdSlotSchema>;

// Either slot can be null: no eligible slot1 creative (or ads disabled/
// viewer is ad-free) means no break at all; a missing slot2 just means a
// one-ad break. See ads/service.ts's getPrerollBreak.
export const prerollBreakSchema = z.object({
  slot1: servedAdSlotSchema.nullable(),
  slot2: servedAdSlotSchema.nullable(),
});
export type PrerollBreak = z.infer<typeof prerollBreakSchema>;

export const recordAdCompletionSchema = z.object({
  completedSeconds: z.number().int().nonnegative(),
  skipped: z.boolean(),
});
export type RecordAdCompletionInput = z.infer<typeof recordAdCompletionSchema>;

export const submitAdLeadSchema = z.object({
  companyName: z.string().min(1).max(140),
  contactName: z.string().min(1).max(140),
  contactEmail: z.string().email(),
  message: z.string().max(2000).optional(),
});
export type SubmitAdLeadInput = z.infer<typeof submitAdLeadSchema>;

// --- Creator Ads Manager ---

export const creatorAdsSettingsSchema = z.object({
  adsEnabled: z.boolean(),
  revenueThisMonthSantim: z.number().int(),
});
export type CreatorAdsSettings = z.infer<typeof creatorAdsSettingsSchema>;

export const updateCreatorAdsSettingsSchema = z.object({
  adsEnabled: z.boolean(),
});
export type UpdateCreatorAdsSettingsInput = z.infer<typeof updateCreatorAdsSettingsSchema>;

// --- Admin: advertisers ---

export const advertiserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: z.enum(["active", "paused", "archived"]),
  createdAt: z.string(),
});
export type Advertiser = z.infer<typeof advertiserSchema>;

export const createAdvertiserSchema = z.object({
  name: z.string().min(1).max(120),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
});
export type CreateAdvertiserInput = z.infer<typeof createAdvertiserSchema>;

// --- Admin: campaigns ---

export const adTargetingInputSchema = z.object({
  category: z.string().optional(),
  language: z.string().optional(),
  minViewers: z.number().int().nonnegative().optional(),
});
export type AdTargetingInput = z.infer<typeof adTargetingInputSchema>;

export const createAdCampaignSchema = z.object({
  advertiserId: z.string().uuid(),
  name: z.string().min(1).max(140),
  budgetSantim: z.number().int().positive(),
  cpmSantim: z.number().int().positive(),
  startsAt: z.string(),
  endsAt: z.string(),
  targeting: adTargetingInputSchema.optional(),
});
export type CreateAdCampaignInput = z.infer<typeof createAdCampaignSchema>;

export const updateAdCampaignStatusSchema = z.object({
  status: z.enum(["draft", "pending_review", "active", "paused", "completed"]),
});
export type UpdateAdCampaignStatusInput = z.infer<typeof updateAdCampaignStatusSchema>;

export const adCampaignAdminItemSchema = z.object({
  id: z.string().uuid(),
  advertiserId: z.string().uuid(),
  advertiserName: z.string(),
  name: z.string(),
  budgetSantim: z.number().int(),
  spentSantim: z.number().int(),
  cpmSantim: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(["draft", "pending_review", "active", "paused", "completed"]),
  targeting: z.object({
    category: z.string().nullable(),
    language: z.string().nullable(),
    minViewers: z.number().int().nullable(),
  }).nullable(),
  creativeCount: z.number().int(),
  impressionCount: z.number().int(),
  clickCount: z.number().int(),
  // Null (not 0) when impressionCount is 0 — "no data yet" is a
  // different, real state from "0% clicked."
  clickThroughRate: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
});
export type AdCampaignAdminItem = z.infer<typeof adCampaignAdminItemSchema>;

// --- Admin: creatives ---

export const createAdCreativeSchema = z
  .object({
    campaignId: z.string().uuid(),
    format: adFormatSchema,
    assetUrl: z.string().min(1).max(500_000),
    clickUrl: z.string().url().optional(),
    durationSeconds: z.number().int().positive().optional(),
    // Only meaningful (and required) when format === "preroll" — see
    // the .refine() below and ad_creatives_preroll_slot_format_check.
    prerollSlot: prerollSlotSchema.optional(),
  })
  .refine((input) => input.format !== "preroll" || input.durationSeconds !== undefined, {
    message: "durationSeconds is required for preroll creatives",
    path: ["durationSeconds"],
  })
  .refine((input) => input.format !== "preroll" || input.prerollSlot !== undefined, {
    message: "prerollSlot is required for preroll creatives",
    path: ["prerollSlot"],
  })
  .refine((input) => input.format === "preroll" || input.prerollSlot === undefined, {
    message: "prerollSlot only applies to preroll creatives",
    path: ["prerollSlot"],
  });
export type CreateAdCreativeInput = z.infer<typeof createAdCreativeSchema>;

export const adCreativeAdminItemSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  format: adFormatSchema,
  assetUrl: z.string(),
  clickUrl: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  prerollSlot: prerollSlotSchema.nullable(),
  approved: z.boolean(),
  // Computed server-side from ad_impressions — real advertiser-facing
  // metrics from data already collected at serve/complete time, not a
  // new tracking pipeline. Null (not 0) when impressionCount is 0, so
  // the admin UI can distinguish "no data yet" from "0% completion."
  impressionCount: z.number().int(),
  clickCount: z.number().int(),
  completionRate: z.number().min(0).max(1).nullable(),
  skipRate: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
});
export type AdCreativeAdminItem = z.infer<typeof adCreativeAdminItemSchema>;

// --- Admin: leads & reporting ---

export const adLeadAdminItemSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string(),
  contactName: z.string(),
  contactEmail: z.string(),
  message: z.string().nullable(),
  status: z.enum(["new", "contacted", "closed"]),
  createdAt: z.string(),
});
export type AdLeadAdminItem = z.infer<typeof adLeadAdminItemSchema>;

export const updateAdLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "closed"]),
});
export type UpdateAdLeadStatusInput = z.infer<typeof updateAdLeadStatusSchema>;

export const adRevenueByCreatorSchema = z.object({
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  impressionCount: z.number().int(),
  totalSantim: z.number().int(),
});
export type AdRevenueByCreator = z.infer<typeof adRevenueByCreatorSchema>;
