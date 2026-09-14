-- Streamer partner/activity tier — Bronze/Silver/Gold/Partner, computed
-- from a creator's LIFETIME watch-hours delivered and gift volume
-- received. Deliberately its own table, not an extension of user_ranks
-- (0025_gursha_gift_economy.sql — viewer gift-SPEND rank) or
-- gifter_badges (per-channel gifter-spend badge) — both of those rank a
-- VIEWER's generosity; this ranks a STREAMER's own growth, a genuinely
-- different subject with no natural home in either existing table.
--
-- A creator must clear BOTH thresholds for a tier (not either), so the
-- tier means "real audience AND real support," not just one or the
-- other — thresholds live in platform_config so they're tunable, not
-- hardcoded.
CREATE TABLE creator_tiers (
    creator_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier                    VARCHAR(10) NOT NULL DEFAULT 'none'
        CHECK (tier IN ('none', 'bronze', 'silver', 'gold', 'partner')),
    lifetime_watch_hours    NUMERIC NOT NULL DEFAULT 0,
    lifetime_gift_volume_santim BIGINT NOT NULL DEFAULT 0,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_config ADD COLUMN creator_tier_bronze_watch_hours INTEGER NOT NULL DEFAULT 10;
ALTER TABLE platform_config ADD COLUMN creator_tier_bronze_gift_volume_santim BIGINT NOT NULL DEFAULT 5000;
ALTER TABLE platform_config ADD COLUMN creator_tier_silver_watch_hours INTEGER NOT NULL DEFAULT 50;
ALTER TABLE platform_config ADD COLUMN creator_tier_silver_gift_volume_santim BIGINT NOT NULL DEFAULT 25000;
ALTER TABLE platform_config ADD COLUMN creator_tier_gold_watch_hours INTEGER NOT NULL DEFAULT 200;
ALTER TABLE platform_config ADD COLUMN creator_tier_gold_gift_volume_santim BIGINT NOT NULL DEFAULT 100000;
ALTER TABLE platform_config ADD COLUMN creator_tier_partner_watch_hours INTEGER NOT NULL DEFAULT 500;
ALTER TABLE platform_config ADD COLUMN creator_tier_partner_gift_volume_santim BIGINT NOT NULL DEFAULT 500000;
