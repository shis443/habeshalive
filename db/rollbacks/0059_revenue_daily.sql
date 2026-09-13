-- Rollback for 0059_revenue_daily.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
DROP VIEW IF EXISTS v_revenue_kpis;
DROP INDEX IF EXISTS idx_ledger_transactions_type_completed;
DROP INDEX IF EXISTS idx_ledger_entries_transaction;
DROP TABLE IF EXISTS revenue_daily;
