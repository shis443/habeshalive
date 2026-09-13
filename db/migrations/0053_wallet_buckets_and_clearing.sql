-- T2. THIS MUST LAND BEFORE THE PLATFORM TAKES REAL MONEY: retrofitting a
-- clearing period after creators have already been paid against uncleared
-- funds means clawing money back from real people. It is a one-way door.

-- Buckets sit on ledger_entries, not on wallets or wallet_balances_cache:
-- the same wallet holds both kinds, and no new running-total column is
-- added anywhere (ground rule: a counter is a second source of truth and
-- it will drift). Both the sender's and recipient's bucket balances are
-- always derived by summing this column directly (common/ledger.ts's
-- getBucketBalances) — wallet_balances_cache stays exactly as it was, a
-- single pooled total, unaware buckets exist.
--
-- Default 'paid' keeps every existing row correct — the promotional
-- concept did not exist when they were written, so none of them were
-- promotional.
ALTER TABLE ledger_entries
    ADD COLUMN funding_bucket VARCHAR(12) NOT NULL DEFAULT 'paid'
        CHECK (funding_bucket IN ('paid','promotional'));

-- The read path every bucket-aware debit takes: "how much of this wallet's
-- current balance, by bucket, right now."
CREATE INDEX idx_ledger_entries_wallet_bucket ON ledger_entries (wallet_id, funding_bucket);

-- Creator earnings clear on a schedule rather than instantly. A gift
-- credits 'pending'; a nightly job moves it to 'cleared' once the
-- chargeback window on the funding top-up has closed.
--
-- Only ever created for the 'paid' portion of a creator's credit — see
-- wallet/service.ts's sendGift. A gift funded (even partially) by the
-- sender's promotional balance credits the creator's wallet immediately
-- and spendably for that portion, but that portion never gets a hold row
-- at all, which is what keeps it permanently outside
-- v_creator_withdrawable's SUM below. "Promotional coins can never reach a
-- payout" is therefore not a rule enforced by later filtering — there is
-- nothing to filter, because no row was ever written for it.
-- 'paid_out' exists so a payout's *consumption* of cleared money is a state
-- transition on these rows, not a second figure someone has to net against
-- v_creator_withdrawable later. reserveFunds (wallet/temporal/activities.ts)
-- locks a creator's 'cleared' rows oldest-cleared-first and flips exactly
-- amount_santim worth of them to 'paid_out' in the same transaction as the
-- payout debit — splitting the one row that straddles the boundary into a
-- consumed remainder and a still-cleared remainder. That is what keeps the
-- view below a plain, always-correct SUM: a paid_out row falls out of the
-- 'cleared' filter the instant it's consumed, so there is never a lifetime
-- total to subtract payouts from.
CREATE TABLE earning_holds (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id              UUID NOT NULL REFERENCES users(id),
    ledger_entry_id         UUID NOT NULL REFERENCES ledger_entries(id),
    amount_santim           BIGINT NOT NULL CHECK (amount_santim > 0),
    state                   VARCHAR(12) NOT NULL DEFAULT 'pending'
                                CHECK (state IN ('pending','cleared','clawed_back','paid_out')),
    -- 14 days: covers the Chapa dispute window with margin.
    clears_at               TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 days',
    cleared_at              TIMESTAMPTZ,
    clawback_reason         TEXT,
    consumed_by_payout_id   UUID REFERENCES payouts(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_earning_holds_due
    ON earning_holds (clears_at) WHERE state = 'pending';
CREATE INDEX idx_earning_holds_creator
    ON earning_holds (creator_id, state);
-- FOR UPDATE consumption order at payout time: oldest-cleared-first.
CREATE INDEX idx_earning_holds_creator_cleared_order
    ON earning_holds (creator_id, cleared_at) WHERE state = 'cleared';

-- Withdrawable = cleared holds not yet consumed by a payout. Exposed as a
-- view, not a table, so no call site can invent its own definition of
-- "withdrawable" — requestPayout reads this and nothing else.
CREATE VIEW v_creator_withdrawable AS
SELECT creator_id,
       SUM(amount_santim) FILTER (WHERE state = 'cleared') AS cleared_santim,
       SUM(amount_santim) FILTER (WHERE state = 'pending') AS pending_santim
FROM earning_holds
GROUP BY creator_id;
