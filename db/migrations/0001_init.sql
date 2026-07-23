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
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number      VARCHAR(20) NOT NULL,
    code_hash         TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    consumed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
