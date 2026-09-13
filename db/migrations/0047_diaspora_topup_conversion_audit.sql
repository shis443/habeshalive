-- Records the exact USD-cents-to-ETB-santim conversion applied to a
-- diaspora (Stripe/PayPal) top-up at the moment it happened —
-- DIASPORA_USD_TO_ETB_RATE (apps/api/src/common/env.ts) is a live env var
-- that can change over time, so without this, an old transaction's santim
-- amount could never be reproduced or explained during a dispute.
--
-- exchange_rate is NUMERIC deliberately, not a violation of this
-- codebase's integer-santim rule for money columns — it's an audit record
-- of an external fractional rate, never re-used in arithmetic. The actual
-- money-moving amount (amount_santim, and the matching ledger_entries rows
-- inserted alongside it) is always a real BIGINT integer.
CREATE TABLE diaspora_topup_conversions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- CASCADE matches ledger_entries' own relationship to
    -- ledger_transactions (0001_init.sql) — this audit row has no reason
    -- to outlive the transaction it explains.
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
    amount_usd_cents      BIGINT NOT NULL CHECK (amount_usd_cents > 0),
    exchange_rate         NUMERIC NOT NULL CHECK (exchange_rate > 0),
    -- Named, not just implied by Math.round — see
    -- diaspora-topup-service.ts's convertUsdCentsToSantim.
    rounding_rule         VARCHAR(20) NOT NULL DEFAULT 'half_up',
    amount_santim         BIGINT NOT NULL CHECK (amount_santim > 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One conversion record per top-up attempt.
CREATE UNIQUE INDEX idx_diaspora_topup_conversions_ledger_transaction
    ON diaspora_topup_conversions(ledger_transaction_id);
