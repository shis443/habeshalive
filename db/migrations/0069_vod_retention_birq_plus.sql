-- Build 3 — Birq Plus perk: a subscriber's own VODs get a longer
-- retention window than the platform default, independent of (and
-- combinable with) the existing Anchor-creator retention
-- (0015_platform_config_settings.sql). createVodFromRecording
-- (vods/service.ts) takes the LONGER of whichever windows apply to a
-- given creator, so an Anchor creator who also subscribes never loses
-- their existing Anchor-level retention.
ALTER TABLE platform_config ADD COLUMN vod_retention_days_birq_plus INTEGER NOT NULL DEFAULT 60;
