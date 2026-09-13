-- The double-entry invariant (a ledger_transaction's debits equal its
-- credits) has been application-convention only since 0001_init.sql —
-- every real call site happens to insert matching insertEntry() pairs
-- (common/ledger.ts), but nothing in the database itself would reject an
-- unbalanced write. This converts "we believe the ledger balances" into
-- "the database will not permit otherwise."
--
-- CONSTRAINT TRIGGER, not a plain trigger: a plain AFTER trigger fires
-- immediately after each row, which would reject every legitimate
-- multi-entry transaction the instant its first row lands, before the
-- matching entry has been inserted (every real path inserts entries one
-- insertEntry() call at a time, not as a single atomic set). DEFERRABLE
-- INITIALLY DEFERRED postpones the check to COMMIT, once every entry for
-- the whole transaction is in place — this is exactly what "deferred to
-- transaction commit" means here, and is a Postgres CONSTRAINT TRIGGER
-- feature a plain trigger doesn't have.
CREATE OR REPLACE FUNCTION check_ledger_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
    affected_transaction_id UUID;
    net_total BIGINT;
BEGIN
    affected_transaction_id := COALESCE(NEW.ledger_transaction_id, OLD.ledger_transaction_id);

    SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_santim ELSE -amount_santim END), 0)
    INTO net_total
    FROM ledger_entries
    WHERE ledger_transaction_id = affected_transaction_id;

    IF net_total != 0 THEN
        RAISE EXCEPTION 'ledger_transaction % is unbalanced: credits minus debits = % santim (expected 0)',
            affected_transaction_id, net_total;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- FOR EACH ROW is the only option Postgres allows for a CONSTRAINT
-- TRIGGER (no FOR EACH STATEMENT variant exists) — harmless here even for
-- a 3-entry revenue-share split: every firing re-sums the *current* state
-- at COMMIT time, so by the time all of a transaction's entries exist,
-- every firing for that transaction sees the same final, correct total.
CREATE CONSTRAINT TRIGGER ledger_entries_balanced_check
    AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_ledger_transaction_balanced();

-- Does NOT retroactively validate rows that existed before this
-- migration — a CONSTRAINT TRIGGER only fires on rows changed after it's
-- created. If historical data already contains an unbalanced
-- ledger_transaction, this migration will still apply cleanly; only a
-- future write to that same transaction's entries would then fail. A
-- one-time backfill audit (the query below, run manually — not part of
-- this migration) is how to find out whether any already exist:
--
--   SELECT ledger_transaction_id,
--          SUM(CASE WHEN direction = 'credit' THEN amount_santim ELSE -amount_santim END) AS net_total
--   FROM ledger_entries
--   GROUP BY ledger_transaction_id
--   HAVING SUM(CASE WHEN direction = 'credit' THEN amount_santim ELSE -amount_santim END) != 0;
--
-- No periodic reconciliation job runs this automatically — this codebase
-- has no scheduler/cron infrastructure at all yet (grepped: none), and
-- picking one is a separate decision from this migration. The existing
-- on-demand admin endpoint (GET /admin/ledger/reconciliation,
-- admin/routes.ts) is the only reconciliation check that currently runs,
-- and only when a finance_auditor/super_admin actually calls it.
