-- Gursha Gift Economy: priced gift tiers (replacing the flat 25-ETB-only
-- catalog from 0019), a platform-wide prestige Rank tracking cumulative
-- Gursha spend (distinct from the existing per-creator gifter_badges --
-- see that migration's own comment on why it's deliberately channel-
-- scoped, "top gifter to THIS creator," not a platform-wide leaderboard),
-- and a sliding-scale platform-wide ad-free subscription (distinct from
-- the existing per-creator subscriptions table, since there's no creator
-- to revenue-split with here -- 100% platform, same shape as
-- stream_boosts).

-- === Gift tiers (Mulmul/Buna/Tej/Kurt) ===
CREATE TABLE gift_tiers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key                 VARCHAR(20) NOT NULL UNIQUE
                            CHECK (key IN ('mulmul', 'buna', 'tej', 'kurt')),
    display_name        VARCHAR(50) NOT NULL,
    base_price_santim   BIGINT NOT NULL CHECK (base_price_santim > 0),
    sort_order          INTEGER NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO gift_tiers (key, display_name, base_price_santim, sort_order) VALUES
    ('mulmul', 'Mulmul', 10000, 1),   --   100 ETB
    ('buna',   'Buna',   20000, 2),   --   200 ETB
    ('tej',    'Tej',    50000, 3),   --   500 ETB
    ('kurt',   'Kurt',   100000, 4);  -- 1,000 ETB base; the existing 100x
                                       -- quantity cap on a single send
                                       -- (packages/shared's sendGiftSchema)
                                       -- already reaches "1000+ ETB" --
                                       -- no new variable-amount mechanism
                                       -- needed.

-- Existing gift_types table (0001_init.sql). Nullable: the 3 pre-Gursha
-- rows with no equivalent in the new catalog are deactivated below rather
-- than backfilled, since they're being retired outright, not migrated
-- forward.
ALTER TABLE gift_types ADD COLUMN gift_tier_id UUID REFERENCES gift_tiers(id);

-- "Classic Mulmul" carries forward under the same name at its new price —
-- updated in place, not deactivated-and-reinserted, so there's exactly
-- one row named "Classic Mulmul", not two. Getting this wrong once during
-- testing produced a real bug: a second "Classic Mulmul" row (the old
-- 2,500-santim one just deactivated, not deleted) made `SELECT id FROM
-- gift_types WHERE name = 'Classic Mulmul'` return two rows with no
-- defined order, so a naive "take the first row" caller could silently
-- get the wrong, retired one.
UPDATE gift_types SET gift_tier_id = (SELECT id FROM gift_tiers WHERE key = 'mulmul'), price_santim = 10000
WHERE name = 'Classic Mulmul';

-- The other 3 pre-Gursha themes have no equivalent in the new catalog —
-- retired outright (is_active = FALSE, not deleted, so historical
-- gifts_sent rows referencing them still resolve).
UPDATE gift_types SET is_active = FALSE WHERE gift_tier_id IS NULL;

INSERT INTO gift_types (name, price_santim, animation_key, gift_tier_id) VALUES
    ('Jebena Buna',    20000,  'buna_jebena',    (SELECT id FROM gift_tiers WHERE key = 'buna')),
    ('Sini Buna',      20000,  'buna_sini',      (SELECT id FROM gift_tiers WHERE key = 'buna')),
    ('Macchiato',      20000,  'buna_macchiato', (SELECT id FROM gift_tiers WHERE key = 'buna')),
    ('Berele Tej',     50000,  'tej_berele',     (SELECT id FROM gift_tiers WHERE key = 'tej')),
    ('Filtered Tej',   50000,  'tej_filtered',   (SELECT id FROM gift_tiers WHERE key = 'tej')),
    ('Special Kurt',   100000, 'kurt_special',   (SELECT id FROM gift_tiers WHERE key = 'kurt'));

-- === Platform-wide Rank (cumulative Gursha spend, NOT per-creator) ===
CREATE TABLE user_ranks (
    user_id                 UUID PRIMARY KEY REFERENCES users(id),
    total_gift_spend_santim BIGINT NOT NULL DEFAULT 0,
    rank                    VARCHAR(20) NOT NULL DEFAULT 'newari'
                                CHECK (rank IN ('newari', 'asir_aleka', 'meto_aleka', 'shi_aleka', 'dejazmach')),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Thresholds live in application code (wallet/service.ts's
-- RANK_THRESHOLDS, same pattern as the existing BADGE_TIER_THRESHOLDS),
-- not as DB rows -- kept here as the reference for what those must match:
--   newari:      0 -           500,000 santim (0 - 5,000 ETB)
--   asir_aleka:  500,000 -   1,000,000 santim
--   meto_aleka:  1,000,000 -  5,000,000 santim
--   shi_aleka:   5,000,000 - 10,000,000 santim
--   dejazmach:   10,000,000+ santim (100,000+ ETB)

-- === Platform-wide sliding-scale ad-free subscription ===
CREATE TABLE platform_subscriptions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    subscriber_id         UUID NOT NULL REFERENCES users(id),
    amount_santim         BIGINT NOT NULL CHECK (amount_santim >= 15000), -- 150 ETB floor; open-ended per spec ("5,000+ ETB")
    status                VARCHAR(20) NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'cancelled', 'expired', 'payment_failed')),
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active (or grace-period) platform subscription per user -- changing
-- the sliding-scale amount updates this row rather than creating a
-- second one.
CREATE UNIQUE INDEX idx_platform_subscriptions_active_subscriber
    ON platform_subscriptions(subscriber_id) WHERE status IN ('active', 'payment_failed');

-- New ledger_transactions.type value, following every prior migration's
-- widen-the-CHECK convention (0003/0010/0021) rather than a parallel enum.
-- The column itself (0001_init.sql) is VARCHAR(20) -- 'platform_subscription'
-- is 21 characters, so it must be widened too, not just the CHECK; found
-- the hard way (a real INSERT against a real database, not a typecheck)
-- during this migration's own verification -- Postgres rejects the value
-- at the column-length level before the CHECK constraint is even
-- evaluated. Widened to 30 for headroom, not just the 21 needed today.
ALTER TABLE ledger_transactions ALTER COLUMN type TYPE VARCHAR(30);
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup','gift','payout','refund','adjustment','subscription','boost','ad','gift_card','platform_subscription'));
