-- Rollback for 0061_payout_batches.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
    CHECK (status IN ('pending_review','processing','paid','failed'));
ALTER TABLE payouts ALTER COLUMN destination SET NOT NULL;
ALTER TABLE payouts DROP COLUMN IF EXISTS instrument_id;
ALTER TABLE payouts DROP COLUMN IF EXISTS batch_id;
DROP TABLE IF EXISTS payout_batches;
