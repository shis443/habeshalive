-- Two-slot video pre-roll: slot1 is always a mandatory, exact-duration,
-- unskippable ad; slot2 is always skippable after a configured number of
-- seconds, whatever its own native duration is. Skip behavior is a
-- property of the SLOT (position in the break), not the campaign or an
-- individual creative's own fields — this is what keeps ad selection a
-- simple extension of the existing random-eligible-creative query
-- (0020_ads.sql's getAdForStream) instead of a new "paired creatives"
-- concept at the campaign level.

ALTER TABLE ad_creatives ADD COLUMN preroll_slot VARCHAR(10)
    CHECK (preroll_slot IN ('slot1', 'slot2'));

-- Only meaningful for format = 'preroll' — every other format (midroll,
-- display_banner, sponsored_card, overlay) must leave this NULL.
ALTER TABLE ad_creatives ADD CONSTRAINT ad_creatives_preroll_slot_format_check
    CHECK (preroll_slot IS NULL OR format = 'preroll');

-- Real completion/skip tracking, alongside the existing ad_clicks table —
-- lets admin reporting show completion-rate/skip-rate/CTR from data
-- that's already being collected at serve time, not a new pipeline.
ALTER TABLE ad_impressions ADD COLUMN completed_seconds INTEGER;
ALTER TABLE ad_impressions ADD COLUMN skipped BOOLEAN NOT NULL DEFAULT FALSE;

-- Admin-tunable, matching the existing ad_revenue_share_bps/
-- ad_frequency_cap_per_hour convention on this same table (0020_ads.sql)
-- rather than hardcoding the "30 seconds" / "5 seconds" rule in code.
ALTER TABLE platform_config ADD COLUMN preroll_slot1_duration_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE platform_config ADD COLUMN preroll_slot2_skip_after_seconds INTEGER NOT NULL DEFAULT 5;
