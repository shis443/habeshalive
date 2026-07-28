-- Settings phase: extend platform_config (introduced in 0014 for boost
-- pricing) with the rest of the values that were previously hardcoded
-- constants scattered across the codebase. Defaults below match those
-- constants exactly, so this deploy is a zero-behavior-change migration —
-- an admin only sees an effect once they actually edit a field.
ALTER TABLE platform_config ADD COLUMN default_revenue_share_bps INTEGER NOT NULL DEFAULT 8000;
ALTER TABLE platform_config ADD COLUMN payout_manual_review_threshold_santim BIGINT NOT NULL DEFAULT 500000;
ALTER TABLE platform_config ADD COLUMN vod_retention_days_default INTEGER NOT NULL DEFAULT 7;
ALTER TABLE platform_config ADD COLUMN vod_retention_days_anchor INTEGER NOT NULL DEFAULT 30;
