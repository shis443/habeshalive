import type { PlatformConfig, UpdatePlatformConfigInput } from "@habeshalive/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";

interface ConfigRow {
  boost_price_santim: number;
  boost_duration_ms: number;
  default_revenue_share_bps: number;
  payout_manual_review_threshold_santim: number;
  vod_retention_days_default: number;
  vod_retention_days_anchor: number;
  approved_creator_cap: number;
  updated_at: string;
  updated_by_username: string | null;
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const { rows } = await pool.query<ConfigRow>(
    `SELECT pc.boost_price_santim, pc.boost_duration_ms, pc.default_revenue_share_bps,
            pc.payout_manual_review_threshold_santim, pc.vod_retention_days_default, pc.vod_retention_days_anchor,
            pc.approved_creator_cap, pc.updated_at, u.username AS updated_by_username
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
    vodRetentionDaysDefault: row.vod_retention_days_default,
    vodRetentionDaysAnchor: row.vod_retention_days_anchor,
    approvedCreatorCap: row.approved_creator_cap,
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

// Read fresh in createVodFromRecording() (vods/service.ts) on every VOD write.
export async function getVodRetentionDays(): Promise<{ default: number; anchor: number }> {
  const { rows } = await pool.query<{ vod_retention_days_default: number; vod_retention_days_anchor: number }>(
    `SELECT vod_retention_days_default, vod_retention_days_anchor FROM platform_config WHERE id = TRUE`
  );
  return { default: rows[0]!.vod_retention_days_default, anchor: rows[0]!.vod_retention_days_anchor };
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
       updated_at = now(), updated_by = $8
     WHERE id = TRUE`,
    [
      input.boostPriceSantim,
      input.boostDurationMs,
      input.defaultRevenueShareBps,
      input.payoutManualReviewThresholdSantim,
      input.vodRetentionDaysDefault,
      input.vodRetentionDaysAnchor,
      input.approvedCreatorCap,
      adminId,
    ]
  );
  await logAdminAction(adminId, "config.update", "platform_config", null, { metadata: input });
  return getPlatformConfig();
}
