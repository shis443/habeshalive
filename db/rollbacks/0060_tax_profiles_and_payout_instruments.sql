-- Rollback for 0060_tax_profiles_and_payout_instruments.sql. Not
-- auto-applied — see db/rollbacks/0050_stream_controls.sql for why this
-- lives outside db/migrations/.
DROP TABLE IF EXISTS payout_instruments;
DROP TABLE IF EXISTS creator_tax_profiles;
