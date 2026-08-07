-- Module 4 (Social Distribution), minus offline overnight VOD downloads
-- (declined earlier — needs a native mobile app's own download/storage
-- manager, not buildable in this web codebase) and literal mobile-carrier
-- airtime redemption (declined for the same "no real telecom API
-- partnership exists" reason as Module 2's Telebirr/CBE Birr — see
-- points-service.ts's own comment: redemption credits real wallet
-- balance instead, which the creator/viewer can actually spend or cash
-- out, not a fake inert "redeem for airtime" button).

-- One-click 9:16 clipper (apps/api/src/vods/clip-service.ts) — real
-- ffmpeg crop+scale of an existing VOD, not a placeholder. object_key is
-- an object-storage key (same never-public-bucket posture as
-- stream_vods.playback_url), signed at read time.
CREATE TABLE clips (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vod_id            UUID NOT NULL REFERENCES stream_vods(id) ON DELETE CASCADE,
    creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(140),
    object_key        TEXT NOT NULL,
    start_seconds     INTEGER NOT NULL CHECK (start_seconds >= 0),
    duration_seconds  INTEGER NOT NULL CHECK (duration_seconds > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clips_creator_created ON clips (creator_id, created_at DESC);
CREATE INDEX idx_clips_vod ON clips (vod_id);

-- Watch-to-Earn (apps/api/src/points/service.ts) — a real points balance,
-- not a wallet-ledger entry: points are minted by watching, not
-- transferred between two parties, so there's no double-entry "other
-- side" the way birr/santim always has. balance is denormalized (kept in
-- sync by points-service.ts on every award/redeem) for a cheap read on
-- the wallet page; point_transactions is the append-only source of truth
-- an audit or dispute would actually check.
CREATE TABLE viewer_points (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE point_transactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta       INTEGER NOT NULL,
    reason      VARCHAR(30) NOT NULL CHECK (reason IN ('watch_heartbeat', 'redeemed_for_wallet_credit')),
    stream_id   UUID REFERENCES streams(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_point_transactions_user_created ON point_transactions (user_id, created_at DESC);

-- Redemption credits real wallet balance — same "money enters the
-- system" ledger shape as a top-up (credit user wallet, debit platform
-- wallet), since Birq itself is the one paying out real ETB for
-- engagement here, not routing an existing balance between two users.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup','gift','payout','refund','adjustment','subscription','boost','ad','gift_card','platform_subscription','donation','ppv_purchase','points_redemption'));
