-- Minimal subscriptions feature: global fixed tiers (not per-creator pricing),
-- paid the same way as gifts (revenue_share_bps split), tracked as their own
-- ledger transaction type so "earnings this month" and the transaction list
-- can tell subs apart from gifts.

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup', 'gift', 'payout', 'refund', 'adjustment', 'subscription'));

CREATE TABLE subscription_tiers (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              VARCHAR(50) NOT NULL,
    price_santim      BIGINT NOT NULL CHECK (price_santim > 0),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE subscriptions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    subscriber_id         UUID NOT NULL REFERENCES users(id),
    creator_id            UUID NOT NULL REFERENCES users(id),
    tier_id               UUID NOT NULL REFERENCES subscription_tiers(id),
    status                VARCHAR(20) NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'cancelled', 'expired')),
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (subscriber_id <> creator_id)
);

CREATE INDEX idx_subscriptions_creator_active ON subscriptions(creator_id) WHERE status = 'active';

INSERT INTO subscription_tiers (name, price_santim)
SELECT * FROM (VALUES
    ('Tier 1', 10000),
    ('Tier 2', 25000),
    ('Tier 3', 50000)
) AS seed(name, price_santim)
WHERE NOT EXISTS (SELECT 1 FROM subscription_tiers);
