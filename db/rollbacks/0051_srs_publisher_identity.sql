-- Rollback for 0051_srs_publisher_identity.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
ALTER TABLE streams
    DROP COLUMN IF EXISTS srs_client_id,
    DROP COLUMN IF EXISTS srs_server_id;
