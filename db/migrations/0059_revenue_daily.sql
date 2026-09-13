-- T6. revenue_daily and /admin/analytics.
--
-- The Overview tiles currently re-scan the whole ledger per page load —
-- free at 46 users, not at 46,000. Deliberately stored, one row per day,
-- rather than computed on demand: a historical figure must not silently
-- change when a refund lands months later just because the query that
-- produces it changed — see the nightly recompute job's own comment
-- (apps/api/src/admin/revenue-daily-service.ts) for why the trailing 35
-- days are recomputed every night, not just yesterday.
CREATE TABLE revenue_daily (
    day                     DATE PRIMARY KEY,
    gross_santim            BIGINT NOT NULL DEFAULT 0,  -- all completed top-ups
    -- Structurally present, currently always 0 — see revenue-daily-
    -- service.ts's own comment on why: this codebase has no distinct,
    -- identifiable "a customer's top-up was refunded" or "a payment was
    -- charged back" concept yet (ledger_transactions.type = 'refund' is
    -- already used for a different purpose — reversing a FAILED PAYOUT,
    -- crediting the creator back — and counting those here would be
    -- actively wrong, not just incomplete, since it has nothing to do
    -- with customer-facing revenue).
    refunds_santim          BIGINT NOT NULL DEFAULT 0,
    chargebacks_santim      BIGINT NOT NULL DEFAULT 0,
    creator_share_santim    BIGINT NOT NULL DEFAULT 0,  -- owed out
    promo_issued_santim     BIGINT NOT NULL DEFAULT 0,  -- marketing cost
    -- Net = gross - refunds - chargebacks - creator_share. Generated, so
    -- no dashboard can define it differently from any other dashboard.
    net_santim              BIGINT GENERATED ALWAYS AS
        (gross_santim - refunds_santim - chargebacks_santim - creator_share_santim) STORED,
    paying_users            INTEGER NOT NULL DEFAULT 0,
    active_users            INTEGER NOT NULL DEFAULT 0,
    active_streamers        INTEGER NOT NULL DEFAULT 0,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Neither index existed before this migration — found by actually
-- running the nightly recompute and the /admin/analytics read path
-- against 1M seeded ledger_entries (this task's own acceptance test),
-- not by inspection. Without idx_ledger_entries_transaction, migration
-- 0048's own deferred balance trigger (which looks up
-- "every ledger_entries row for this ledger_transaction_id" once per
-- affected row, at COMMIT) has no supporting index either — a bulk
-- insert of 1M ledger_entries genuinely never finished; a real backend
-- process was still executing the COMMIT five minutes later before it
-- was terminated. This is additive only: it does not touch the trigger
-- itself (a stop-and-ask boundary), it just gives the trigger's own
-- query, and analytics-service.ts's period-summary queries, something
-- to seek on instead of a sequential scan.
CREATE INDEX idx_ledger_entries_transaction ON ledger_entries (ledger_transaction_id);

-- Every T5/T6 query that reads real-time period totals (analytics-
-- service.ts's getPeriodSummary, leaderboard-service.ts's per-board
-- queries, revenue-daily-service.ts's per-day recompute) filters
-- ledger_transactions by type and a completed_at range together — this
-- composite index is a direct index scan for that exact shape instead of
-- a sequential scan over every transaction ever written, regardless of
-- type.
CREATE INDEX idx_ledger_transactions_type_completed ON ledger_transactions (type, completed_at);

-- ARPU and conversion are ratios of the above, never stored: storing a
-- ratio invites two places disagreeing about the denominator.
CREATE VIEW v_revenue_kpis AS
SELECT day,
       gross_santim, net_santim, active_users, paying_users, active_streamers,
       CASE WHEN active_users = 0 THEN 0
            ELSE ROUND(gross_santim::NUMERIC / active_users, 2) END AS arpu_santim,
       CASE WHEN paying_users = 0 THEN 0
            ELSE ROUND(gross_santim::NUMERIC / paying_users, 2) END AS arppu_santim,
       CASE WHEN active_users = 0 THEN 0
            ELSE ROUND(100.0 * paying_users / active_users, 2) END AS conversion_pct
FROM revenue_daily;
