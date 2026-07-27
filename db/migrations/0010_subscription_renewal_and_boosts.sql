-- Subscription renewal: adds the grace-period state the renewal job needs.
-- No new "attempts" counter — the state machine itself carries the retry:
-- active -> (charge fails) -> payment_failed -> (charge fails again) ->
-- cancelled. A second consecutive failure is what actually cancels; one
-- failure alone just starts the grace period, matching how real
-- subscription systems avoid canceling on a single bad charge.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'cancelled', 'expired', 'payment_failed'));

-- Own ledger transaction type, same reasoning as 'subscription' getting
-- its own type in 0003: earnings/transaction-history views need to tell a
-- boost purchase apart from a generic adjustment.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup', 'gift', 'payout', 'refund', 'adjustment', 'subscription', 'boost'));

-- Stream boosts: a creator pays to have their live stream sorted first /
-- badged "Boosted" for a fixed window. 100% to platform (the creator is
-- the buyer here, not a revenue-sharer with themselves), so this reuses
-- ledger_transactions the same way gifts/subs do, just without a creator
-- credit leg.
CREATE TABLE stream_boosts (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id             UUID NOT NULL REFERENCES users(id),
    ledger_transaction_id  UUID NOT NULL REFERENCES ledger_transactions(id),
    starts_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at                TIMESTAMPTZ NOT NULL,
    price_santim           BIGINT NOT NULL CHECK (price_santim > 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only query this table serves at read time: "is this creator
-- currently boosted", used to sort/badge the live list.
CREATE INDEX idx_stream_boosts_active ON stream_boosts(creator_id, ends_at);
