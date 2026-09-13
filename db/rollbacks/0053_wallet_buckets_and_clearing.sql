-- Rollback for 0053_wallet_buckets_and_clearing.sql. Not auto-applied —
-- see db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
DROP VIEW IF EXISTS v_creator_withdrawable;
DROP TABLE IF EXISTS earning_holds;
DROP INDEX IF EXISTS idx_ledger_entries_wallet_bucket;
ALTER TABLE ledger_entries DROP COLUMN IF EXISTS funding_bucket;
