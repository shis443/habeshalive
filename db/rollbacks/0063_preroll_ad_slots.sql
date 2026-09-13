ALTER TABLE platform_config DROP COLUMN preroll_slot2_skip_after_seconds;
ALTER TABLE platform_config DROP COLUMN preroll_slot1_duration_seconds;
ALTER TABLE ad_impressions DROP COLUMN skipped;
ALTER TABLE ad_impressions DROP COLUMN completed_seconds;
ALTER TABLE ad_creatives DROP CONSTRAINT ad_creatives_preroll_slot_format_check;
ALTER TABLE ad_creatives DROP COLUMN preroll_slot;
