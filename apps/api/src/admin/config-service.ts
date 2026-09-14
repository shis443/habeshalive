import type { PlatformConfig, UpdatePlatformConfigInput } from "@birq/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";

interface ConfigRow {
  boost_price_santim: number;
  boost_duration_ms: number;
  default_revenue_share_bps: number;
  payout_manual_review_threshold_santim: number;
  payout_minimum_amount_santim: number;
  vod_retention_days_default: number;
  vod_retention_days_anchor: number;
  vod_retention_days_birq_plus: number;
  birq_plus_emote_slot_count: number;
  approved_creator_cap: number;
  ad_revenue_share_bps: number;
  ad_frequency_cap_per_hour: number;
  preroll_slot1_duration_seconds: number;
  preroll_slot2_skip_after_seconds: number;
  gift_card_expiry_months: number;
  kyc_required_for_payouts: boolean;
  creator_tier_bronze_watch_hours: number;
  creator_tier_bronze_gift_volume_santim: number;
  creator_tier_silver_watch_hours: number;
  creator_tier_silver_gift_volume_santim: number;
  creator_tier_gold_watch_hours: number;
  creator_tier_gold_gift_volume_santim: number;
  creator_tier_partner_watch_hours: number;
  creator_tier_partner_gift_volume_santim: number;
  updated_at: string;
  updated_by_username: string | null;
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const { rows } = await pool.query<ConfigRow>(
    `SELECT pc.boost_price_santim, pc.boost_duration_ms, pc.default_revenue_share_bps,
            pc.payout_manual_review_threshold_santim, pc.payout_minimum_amount_santim,
            pc.vod_retention_days_default, pc.vod_retention_days_anchor,
            pc.vod_retention_days_birq_plus, pc.birq_plus_emote_slot_count,
            pc.approved_creator_cap, pc.ad_revenue_share_bps, pc.ad_frequency_cap_per_hour,
            pc.preroll_slot1_duration_seconds, pc.preroll_slot2_skip_after_seconds, pc.gift_card_expiry_months,
            pc.kyc_required_for_payouts,
            pc.creator_tier_bronze_watch_hours, pc.creator_tier_bronze_gift_volume_santim,
            pc.creator_tier_silver_watch_hours, pc.creator_tier_silver_gift_volume_santim,
            pc.creator_tier_gold_watch_hours, pc.creator_tier_gold_gift_volume_santim,
            pc.creator_tier_partner_watch_hours, pc.creator_tier_partner_gift_volume_santim,
            pc.updated_at, u.username AS updated_by_username
     FROM platform_config pc
     LEFT JOIN users u ON u.id = pc.updated_by
     WHERE pc.id = TRUE`
  );
  const row = rows[0]!;
  return {
    boostPriceSantim: row.boost_price_santim,
    boostDurationMs: row.boost_duration_ms,
    defaultRevenueShareBps: row.default_revenue_share_bps,
    payoutManualReviewThresholdSantim: row.payout_manual_review_threshold_santim,
    payoutMinimumAmountSantim: row.payout_minimum_amount_santim,
    vodRetentionDaysDefault: row.vod_retention_days_default,
    vodRetentionDaysAnchor: row.vod_retention_days_anchor,
    vodRetentionDaysBirqPlus: row.vod_retention_days_birq_plus,
    birqPlusEmoteSlotCount: row.birq_plus_emote_slot_count,
    approvedCreatorCap: row.approved_creator_cap,
    adRevenueShareBps: row.ad_revenue_share_bps,
    adFrequencyCapPerHour: row.ad_frequency_cap_per_hour,
    prerollSlot1DurationSeconds: row.preroll_slot1_duration_seconds,
    prerollSlot2SkipAfterSeconds: row.preroll_slot2_skip_after_seconds,
    giftCardExpiryMonths: row.gift_card_expiry_months,
    kycRequiredForPayouts: row.kyc_required_for_payouts,
    creatorTierBronzeWatchHours: row.creator_tier_bronze_watch_hours,
    creatorTierBronzeGiftVolumeSantim: row.creator_tier_bronze_gift_volume_santim,
    creatorTierSilverWatchHours: row.creator_tier_silver_watch_hours,
    creatorTierSilverGiftVolumeSantim: row.creator_tier_silver_gift_volume_santim,
    creatorTierGoldWatchHours: row.creator_tier_gold_watch_hours,
    creatorTierGoldGiftVolumeSantim: row.creator_tier_gold_gift_volume_santim,
    creatorTierPartnerWatchHours: row.creator_tier_partner_watch_hours,
    creatorTierPartnerGiftVolumeSantim: row.creator_tier_partner_gift_volume_santim,
    updatedAt: row.updated_at,
    updatedByUsername: row.updated_by_username,
  };
}

// The single source boostStream() (streams/service.ts) actually charges
// against — separate from getPlatformConfig() above so a hot write path
// isn't dragging in the admin username join it doesn't need.
export async function getBoostPricing(): Promise<{ priceSantim: number; durationMs: number }> {
  const { rows } = await pool.query<{ boost_price_santim: number; boost_duration_ms: number }>(
    `SELECT boost_price_santim, boost_duration_ms FROM platform_config WHERE id = TRUE`
  );
  return { priceSantim: rows[0]!.boost_price_santim, durationMs: rows[0]!.boost_duration_ms };
}

// Same lean-read pattern as getBoostPricing() — ensureCreatorProfile()
// (streams/service.ts) reads this fresh on every new creator, no caching.
export async function getDefaultRevenueShareBps(): Promise<number> {
  const { rows } = await pool.query<{ default_revenue_share_bps: number }>(
    `SELECT default_revenue_share_bps FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.default_revenue_share_bps;
}

// Read fresh in requestPayout() (wallet/service.ts) on every payout request.
export async function getPayoutManualReviewThreshold(): Promise<number> {
  const { rows } = await pool.query<{ payout_manual_review_threshold_santim: number }>(
    `SELECT payout_manual_review_threshold_santim FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.payout_manual_review_threshold_santim;
}

// Read fresh in requestPayout() (wallet/service.ts) on every payout request.
export async function getPayoutMinimumAmount(): Promise<number> {
  const { rows } = await pool.query<{ payout_minimum_amount_santim: number }>(
    `SELECT payout_minimum_amount_santim FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.payout_minimum_amount_santim;
}

// Read fresh in createVodFromRecording() (vods/service.ts) on every VOD
// write. birqPlus (Build 3) is a separate, combinable window — that
// function takes the LONGER of anchor-or-default and birqPlus, rather
// than birqPlus replacing the Anchor-tier number outright.
export async function getVodRetentionDays(): Promise<{ default: number; anchor: number; birqPlus: number }> {
  const { rows } = await pool.query<{
    vod_retention_days_default: number;
    vod_retention_days_anchor: number;
    vod_retention_days_birq_plus: number;
  }>(
    `SELECT vod_retention_days_default, vod_retention_days_anchor, vod_retention_days_birq_plus FROM platform_config WHERE id = TRUE`
  );
  return {
    default: rows[0]!.vod_retention_days_default,
    anchor: rows[0]!.vod_retention_days_anchor,
    birqPlus: rows[0]!.vod_retention_days_birq_plus,
  };
}

// Read fresh in emotes/service.ts's enqueueEmote on every upload attempt.
export async function getBirqPlusEmoteSlotCount(): Promise<number> {
  const { rows } = await pool.query<{ birq_plus_emote_slot_count: number }>(
    `SELECT birq_plus_emote_slot_count FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.birq_plus_emote_slot_count;
}

// Read fresh by ads/service.ts on every ad-serve call and every settlement run.
export async function getAdConfig(): Promise<{ revenueShareBps: number; frequencyCapPerHour: number }> {
  const { rows } = await pool.query<{ ad_revenue_share_bps: number; ad_frequency_cap_per_hour: number }>(
    `SELECT ad_revenue_share_bps, ad_frequency_cap_per_hour FROM platform_config WHERE id = TRUE`
  );
  return { revenueShareBps: rows[0]!.ad_revenue_share_bps, frequencyCapPerHour: rows[0]!.ad_frequency_cap_per_hour };
}

// Read fresh by ads/service.ts's getPrerollBreak on every watch-page load.
export async function getPrerollConfig(): Promise<{ slot1DurationSeconds: number; slot2SkipAfterSeconds: number }> {
  const { rows } = await pool.query<{
    preroll_slot1_duration_seconds: number;
    preroll_slot2_skip_after_seconds: number;
  }>(`SELECT preroll_slot1_duration_seconds, preroll_slot2_skip_after_seconds FROM platform_config WHERE id = TRUE`);
  return {
    slot1DurationSeconds: rows[0]!.preroll_slot1_duration_seconds,
    slot2SkipAfterSeconds: rows[0]!.preroll_slot2_skip_after_seconds,
  };
}

// Read fresh by gift-cards/service.ts on every purchase.
export async function getGiftCardExpiryMonths(): Promise<number> {
  const { rows } = await pool.query<{ gift_card_expiry_months: number }>(
    `SELECT gift_card_expiry_months FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.gift_card_expiry_months;
}

// Read fresh in requestPayout() (wallet/service.ts) on every payout
// request — see 0032_kyc.sql's comment on why this defaults false.
export async function getKycRequiredForPayouts(): Promise<boolean> {
  const { rows } = await pool.query<{ kyc_required_for_payouts: boolean }>(
    `SELECT kyc_required_for_payouts FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.kyc_required_for_payouts;
}

// Read fresh by streams/creator-tiers-service.ts's recomputeCreatorTiers
// on every sweep run — same lean-read convention as getPrerollConfig.
export interface CreatorTierThresholds {
  bronze: { watchHours: number; giftVolumeSantim: number };
  silver: { watchHours: number; giftVolumeSantim: number };
  gold: { watchHours: number; giftVolumeSantim: number };
  partner: { watchHours: number; giftVolumeSantim: number };
}

export async function getCreatorTierThresholds(): Promise<CreatorTierThresholds> {
  const { rows } = await pool.query<{
    creator_tier_bronze_watch_hours: number;
    creator_tier_bronze_gift_volume_santim: number;
    creator_tier_silver_watch_hours: number;
    creator_tier_silver_gift_volume_santim: number;
    creator_tier_gold_watch_hours: number;
    creator_tier_gold_gift_volume_santim: number;
    creator_tier_partner_watch_hours: number;
    creator_tier_partner_gift_volume_santim: number;
  }>(
    `SELECT creator_tier_bronze_watch_hours, creator_tier_bronze_gift_volume_santim,
            creator_tier_silver_watch_hours, creator_tier_silver_gift_volume_santim,
            creator_tier_gold_watch_hours, creator_tier_gold_gift_volume_santim,
            creator_tier_partner_watch_hours, creator_tier_partner_gift_volume_santim
     FROM platform_config WHERE id = TRUE`
  );
  const row = rows[0]!;
  return {
    bronze: { watchHours: row.creator_tier_bronze_watch_hours, giftVolumeSantim: row.creator_tier_bronze_gift_volume_santim },
    silver: { watchHours: row.creator_tier_silver_watch_hours, giftVolumeSantim: row.creator_tier_silver_gift_volume_santim },
    gold: { watchHours: row.creator_tier_gold_watch_hours, giftVolumeSantim: row.creator_tier_gold_gift_volume_santim },
    partner: {
      watchHours: row.creator_tier_partner_watch_hours,
      giftVolumeSantim: row.creator_tier_partner_gift_volume_santim,
    },
  };
}

export async function updatePlatformConfig(adminId: string, input: UpdatePlatformConfigInput): Promise<PlatformConfig> {
  await pool.query(
    `UPDATE platform_config SET
       boost_price_santim = $1,
       boost_duration_ms = $2,
       default_revenue_share_bps = $3,
       payout_manual_review_threshold_santim = $4,
       vod_retention_days_default = $5,
       vod_retention_days_anchor = $6,
       approved_creator_cap = $7,
       ad_revenue_share_bps = $8,
       ad_frequency_cap_per_hour = $9,
       preroll_slot1_duration_seconds = $10,
       preroll_slot2_skip_after_seconds = $11,
       gift_card_expiry_months = $12,
       kyc_required_for_payouts = $13,
       creator_tier_bronze_watch_hours = $14,
       creator_tier_bronze_gift_volume_santim = $15,
       creator_tier_silver_watch_hours = $16,
       creator_tier_silver_gift_volume_santim = $17,
       creator_tier_gold_watch_hours = $18,
       creator_tier_gold_gift_volume_santim = $19,
       creator_tier_partner_watch_hours = $20,
       creator_tier_partner_gift_volume_santim = $21,
       vod_retention_days_birq_plus = $22,
       birq_plus_emote_slot_count = $23,
       payout_minimum_amount_santim = $24,
       updated_at = now(), updated_by = $25
     WHERE id = TRUE`,
    [
      input.boostPriceSantim,
      input.boostDurationMs,
      input.defaultRevenueShareBps,
      input.payoutManualReviewThresholdSantim,
      input.vodRetentionDaysDefault,
      input.vodRetentionDaysAnchor,
      input.approvedCreatorCap,
      input.adRevenueShareBps,
      input.adFrequencyCapPerHour,
      input.prerollSlot1DurationSeconds,
      input.prerollSlot2SkipAfterSeconds,
      input.giftCardExpiryMonths,
      input.kycRequiredForPayouts,
      input.creatorTierBronzeWatchHours,
      input.creatorTierBronzeGiftVolumeSantim,
      input.creatorTierSilverWatchHours,
      input.creatorTierSilverGiftVolumeSantim,
      input.creatorTierGoldWatchHours,
      input.creatorTierGoldGiftVolumeSantim,
      input.creatorTierPartnerWatchHours,
      input.creatorTierPartnerGiftVolumeSantim,
      input.vodRetentionDaysBirqPlus,
      input.birqPlusEmoteSlotCount,
      input.payoutMinimumAmountSantim,
      adminId,
    ]
  );
  await logAdminAction(adminId, "config.update", "platform_config", null, { metadata: input });
  return getPlatformConfig();
}
