-- HabeshaLive database schema — source of truth.
-- Applied incrementally via db/migrations/. This file always reflects
-- the current combined state of every migration, in order.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS & AUTH
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number      VARCHAR(20) UNIQUE,
    email             VARCHAR(255) UNIQUE,
    username          VARCHAR(30) UNIQUE NOT NULL,
    display_name      VARCHAR(50) NOT NULL,
    avatar_url        TEXT,
    bio               VARCHAR(300),
    password_hash     TEXT,
    role              VARCHAR(20) NOT NULL DEFAULT 'viewer'
                          CHECK (role IN ('viewer', 'creator', 'moderator', 'admin')),
    is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'simple' config, not 'english': avoids English-specific stemming
    -- mishandling Amharic (Ge'ez script) text. See db/migrations/0008_search.sql.
    search_vector     tsvector GENERATED ALWAYS AS (
                          to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(bio, ''))
                      ) STORED
);
CREATE INDEX idx_users_search ON users USING GIN (search_vector);

-- Exactly one of phone_number/email is set per row — powers both the
-- phone OTP flow and the email OTP flow with the same mechanism.
CREATE TABLE otp_codes (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number      VARCHAR(20),
    email             VARCHAR(255),
    code_hash         TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    consumed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (phone_number IS NOT NULL AND email IS NULL) OR
        (phone_number IS NULL AND email IS NOT NULL)
    )
);
CREATE INDEX idx_otp_codes_phone ON otp_codes (phone_number, created_at) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_otp_codes_email ON otp_codes (email, created_at) WHERE email IS NOT NULL;

CREATE TABLE follows (
    follower_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, creator_id),
    CHECK (follower_id <> creator_id)
);

-- CREATOR PROFILE
CREATE TABLE creator_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stream_key          TEXT UNIQUE NOT NULL,
    revenue_share_bps   INTEGER NOT NULL DEFAULT 8000 CHECK (revenue_share_bps BETWEEN 0 AND 10000),
    category            VARCHAR(50),
    is_anchor_creator    BOOLEAN NOT NULL DEFAULT FALSE,
    payout_method        VARCHAR(20) DEFAULT 'telebirr' CHECK (payout_method IN ('telebirr','bank')),
    payout_account        TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- STREAMS
CREATE TABLE streams (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(140) NOT NULL,
    category          VARCHAR(50),
    language          VARCHAR(30),
    thumbnail_url     TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'live', 'ended')),
    playback_url      TEXT,
    provider_stream_id TEXT,
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    peak_viewers      INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector     tsvector GENERATED ALWAYS AS (
                          to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category, ''))
                      ) STORED
);
CREATE INDEX idx_streams_search ON streams USING GIN (search_vector);

CREATE TABLE stream_vods (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id         UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    playback_url      TEXT NOT NULL,
    duration_seconds  INTEGER,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHAT & MODERATION
CREATE TABLE chat_messages (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id         UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id),
    body              VARCHAR(500) NOT NULL,
    is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moderation_actions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id         UUID REFERENCES streams(id) ON DELETE CASCADE,
    actor_id          UUID NOT NULL REFERENCES users(id),
    target_user_id    UUID NOT NULL REFERENCES users(id),
    action            VARCHAR(20) NOT NULL CHECK (action IN ('delete_message','timeout','ban','unban')),
    reason             VARCHAR(300),
    duration_seconds   INTEGER,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Flags (not deletes) user-generated text matching a blocklist term, for
-- human review — distinct from moderation_actions above, which logs what a
-- moderator actually did. Applied at the two real user-text endpoints that
-- exist today (stream title, gift message); see docs/architecture.md.
CREATE TABLE moderation_flags (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type      VARCHAR(20) NOT NULL CHECK (content_type IN ('stream_title','gift_message')),
    content_id        UUID NOT NULL,
    author_id         UUID NOT NULL REFERENCES users(id),
    text_snapshot     TEXT NOT NULL,
    matched_terms     TEXT[] NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','removed')),
    reviewed_by       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_moderation_flags_status ON moderation_flags (status, created_at);

-- User-submitted reports, distinct from moderation_flags (the automated
-- blocklist scan above).
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id     UUID NOT NULL REFERENCES users(id),
    target_type     VARCHAR(20) NOT NULL CHECK (target_type IN ('stream','user','gift_message')),
    target_id       UUID NOT NULL,
    reason          VARCHAR(30) NOT NULL CHECK (reason IN ('harassment','hate_speech','spam','nudity','other')),
    details         VARCHAR(500),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','actioned','dismissed')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status ON reports (status, created_at);

-- Appeals against a ban (see app.ts's authenticate decorator for
-- enforcement).
CREATE TABLE appeals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    reason          VARCHAR(1000) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appeals_status ON appeals (status, created_at);

-- WALLET — DOUBLE ENTRY LEDGER
CREATE TABLE wallets (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_type        VARCHAR(10) NOT NULL CHECK (owner_type IN ('user','platform')),
    owner_id          UUID,
    currency          VARCHAR(3) NOT NULL DEFAULT 'ETB',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_type, owner_id, currency)
);

CREATE TABLE ledger_transactions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type              VARCHAR(20) NOT NULL CHECK (type IN ('topup','gift','payout','refund','adjustment')),
    reference         TEXT,
    stream_id         UUID REFERENCES streams(id),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','reversed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_ledger_reference ON ledger_transactions(reference) WHERE reference IS NOT NULL;

CREATE TABLE ledger_entries (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
    wallet_id             UUID NOT NULL REFERENCES wallets(id),
    direction              VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
    amount_santim          BIGINT NOT NULL CHECK (amount_santim > 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_balances_cache (
    wallet_id         UUID PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
    balance_santim    BIGINT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gift_types (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              VARCHAR(50) NOT NULL,
    price_santim      BIGINT NOT NULL CHECK (price_santim > 0),
    animation_key     VARCHAR(50) NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE gifts_sent (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    sender_id         UUID NOT NULL REFERENCES users(id),
    creator_id        UUID NOT NULL REFERENCES users(id),
    stream_id         UUID NOT NULL REFERENCES streams(id),
    gift_type_id      UUID NOT NULL REFERENCES gift_types(id),
    quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    message            VARCHAR(200),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    creator_id        UUID NOT NULL REFERENCES users(id),
    amount_santim     BIGINT NOT NULL CHECK (amount_santim > 0),
    method            VARCHAR(20) NOT NULL CHECK (method IN ('telebirr','bank')),
    destination       TEXT NOT NULL,
    bank_code         TEXT,
    chapa_reference   TEXT,
    failure_reason    TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review','processing','paid','failed')),
    requires_manual_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at           TIMESTAMPTZ
);

CREATE VIEW v_live_streams AS
SELECT s.id, s.title, s.category, s.language, s.thumbnail_url, s.playback_url, s.started_at,
       u.id AS creator_id, u.username, u.display_name, u.avatar_url
FROM streams s JOIN users u ON u.id = s.creator_id
WHERE s.status = 'live';

-- Platform wallet is a ledger singleton. Postgres UNIQUE constraints don't
-- deduplicate NULL owner_id, so it must be seeded once here rather than
-- lazily created at runtime (which would race under concurrent requests).
INSERT INTO wallets (owner_type, owner_id, currency)
SELECT 'platform', NULL, 'ETB'
WHERE NOT EXISTS (
    SELECT 1 FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB'
);

INSERT INTO wallet_balances_cache (wallet_id, balance_santim)
SELECT id, 0 FROM wallets
WHERE owner_type = 'platform' AND currency = 'ETB'
  AND id NOT IN (SELECT wallet_id FROM wallet_balances_cache);

-- Gift catalog matching the approved Watch page design (obsidian_watch_experience).
INSERT INTO gift_types (name, price_santim, animation_key)
SELECT * FROM (VALUES
    ('Buna', 500, 'buna'),
    ('Injera', 2000, 'injera'),
    ('Lion', 10000, 'lion'),
    ('Crown', 50000, 'crown')
) AS seed(name, price_santim, animation_key)
WHERE NOT EXISTS (SELECT 1 FROM gift_types);

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

-- Avatar builder: a catalog of parts per category, and one selected part per
-- category per user. Rendering is a server-generated placeholder SVG (flat
-- swatches) for now — real layered character art can replace the renderer
-- later without touching this data model.

CREATE TABLE avatar_parts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category      VARCHAR(20) NOT NULL
                      CHECK (category IN ('background', 'skin_tone', 'hair', 'eyes', 'accessories')),
    name          VARCHAR(50) NOT NULL,
    swatch_color  VARCHAR(7),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_avatar_parts_category ON avatar_parts(category, sort_order);

CREATE TABLE user_avatar_selections (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    VARCHAR(20) NOT NULL
                    CHECK (category IN ('background', 'skin_tone', 'hair', 'eyes', 'accessories')),
    part_id     UUID NOT NULL REFERENCES avatar_parts(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category)
);

INSERT INTO avatar_parts (category, name, swatch_color, sort_order)
SELECT * FROM (VALUES
    ('background', 'None',            NULL,      0),
    ('background', 'Obsidian Black',  '#060e20', 1),
    ('background', 'Midnight Purple', '#3c0091', 2),
    ('background', 'Deep Teal',       '#003640', 3),
    ('background', 'Charcoal',        '#131b2e', 4),
    ('background', 'Warm Ember',      '#ffb869', 5),

    ('skin_tone',  'Default',  '#a0785a', 0),
    ('skin_tone',  'Skin 1',   '#3d2314', 1),
    ('skin_tone',  'Skin 2',   '#8d5524', 2),
    ('skin_tone',  'Skin 3',   '#c68642', 3),
    ('skin_tone',  'Skin 4',   '#e0ac69', 4),
    ('skin_tone',  'Skin 5',   '#f1c27d', 5),

    ('hair', 'None',        NULL,      0),
    ('hair', 'Afro Large',  '#1a1a1a', 1),
    ('hair', 'Box Braids',  '#2b1810', 2),
    ('hair', 'Short Fade',  '#0d0d0d', 3),
    ('hair', 'Curly Bob',   '#4a2c17', 4),
    ('hair', 'Locs',        '#1f1108', 5),

    ('eyes', 'None',        NULL,      0),
    ('eyes', 'Warm Brown',  '#6b4226', 1),
    ('eyes', 'Deep Black',  '#1a1a1a', 2),
    ('eyes', 'Hazel',       '#8b6b3d', 3),
    ('eyes', 'Teal Accent', '#4cd7f6', 4),

    ('accessories', 'None',          NULL,      0),
    ('accessories', 'Purple Hoops',  '#d0bcff', 1),
    ('accessories', 'Teal Studs',    '#4cd7f6', 2),
    ('accessories', 'Silver Chain',  '#c0c0c0', 3),
    ('accessories', 'Glasses',       '#2d3449', 4)
) AS seed(category, name, swatch_color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM avatar_parts);
