-- Rollback for 0055_gift_catalog_extensions.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
ALTER TABLE gifts_sent DROP COLUMN IF EXISTS creator_share_bps;
ALTER TABLE gift_types
    DROP COLUMN IF EXISTS category,
    DROP COLUMN IF EXISTS creator_share_bps,
    DROP COLUMN IF EXISTS available_from,
    DROP COLUMN IF EXISTS available_until,
    DROP COLUMN IF EXISTS regions;
