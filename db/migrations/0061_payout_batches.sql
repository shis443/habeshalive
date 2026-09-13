-- T7. Payouts are approved and executed in batches: one finance review,
-- one reconciliation against the processor's settlement file, one number
-- to match against the bank statement.
CREATE TABLE payout_batches (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference           VARCHAR(40) UNIQUE NOT NULL,   -- e.g. BATCH-2026-09-W37
    method              VARCHAR(20) NOT NULL
                            CHECK (method IN ('telebirr','bank')),
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','pending_approval','approved',
                                              'processing','settled','rejected')),
    total_santim        BIGINT NOT NULL DEFAULT 0,
    item_count          INTEGER NOT NULL DEFAULT 0,
    -- Four-eyes: whoever assembles a batch cannot be whoever approves it.
    -- Enforced here at the database, AND at the API layer (which must
    -- reject with a clear error rather than let a self-approval attempt
    -- surface as a raw constraint violation).
    prepared_by         UUID NOT NULL REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    settlement_ref      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payout_batch_four_eyes
        CHECK (approved_by IS NULL OR approved_by <> prepared_by)
);

ALTER TABLE payouts
    ADD COLUMN batch_id UUID REFERENCES payout_batches(id),
    ADD COLUMN instrument_id UUID REFERENCES payout_instruments(id);

-- destination stored the full account number as plaintext (see 0060's
-- comment) — going forward every payout is instrument-based and this
-- column is simply left NULL; the display value comes from joining
-- payout_instruments.display_tail instead. Not dropped outright: no real
-- payout has ever happened yet (this migration explicitly must land
-- before the first one), so there is no historical data to preserve, but
-- dropping a column outright is more disruptive than making it optional,
-- and nothing here needs it removed to be correct.
ALTER TABLE payouts ALTER COLUMN destination DROP NOT NULL;

-- Widen the status set to the states a real payout passes through —
-- 'approved' (batch-approved, not yet disbursed), 'rejected' (an admin's
-- deliberate decision, distinct from 'failed', a technical/processor
-- error), 'reversed' (a completed payout later clawed back).
ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
    CHECK (status IN ('pending_review','approved','processing',
                      'paid','rejected','failed','reversed'));
