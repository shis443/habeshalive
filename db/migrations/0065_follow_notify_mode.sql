-- Per-follow notification granularity — the existing
-- notification_preferences.live_alerts (0013_admin_audit_and_blocklist.sql
-- lineage) is a single GLOBAL on/off switch across every creator a viewer
-- follows. This adds a per-creator override on top of it, matching the
-- "Follow -> Following + bell" UX (All/Personalized/Muted) that a
-- Twitch-style follow button exposes per channel.
--
-- Semantics (a new product decision, not a pre-existing spec):
--   all          -> every live-start AND scheduled-announcement notification
--                   from this creator
--   personalized -> live-start only (skips announcement noise)
--   muted        -> no creator-specific notifications; the follow itself
--                   still counts toward the creator's follower count
ALTER TABLE follows ADD COLUMN notify_mode VARCHAR(12) NOT NULL DEFAULT 'all'
    CHECK (notify_mode IN ('all', 'personalized', 'muted'));
