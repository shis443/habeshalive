-- Module 2 (Localized Monetization): custom-amount donations (the actual
-- "live overlay" event — see apps/api/src/wallet/service.ts's
-- publishGiftAlert, reused here) and per-stream pay-per-view access.
--
-- Both are funded from the viewer's existing wallet balance, same as
-- gifts_sent — not a new direct-Chapa-checkout path. The "real-time Chapa"
-- half of this module is already true by the time money reaches either of
-- these tables: it arrived via the existing, real initiateTopup/
-- completeTopupFromWebhook Chapa integration. Donations/PPV are what a
-- viewer does with wallet balance once they have it, exactly like a gift.

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup','gift','payout','refund','adjustment','subscription','boost','ad','gift_card','platform_subscription','donation','ppv_purchase'));

-- A donation's message gets the same moderation scan a gift's message
-- already does (see moderation/service.ts's ModerationContentType).
ALTER TABLE moderation_flags DROP CONSTRAINT moderation_flags_content_type_check;
ALTER TABLE moderation_flags ADD CONSTRAINT moderation_flags_content_type_check
    CHECK (content_type IN ('stream_title', 'gift_message', 'chat_message', 'stream_thumbnail', 'donation_message'));

-- Distinct from gifts_sent (catalog items — gift_type_id, fixed price,
-- quantity) rather than reusing it with a nullable gift_type_id: a
-- donation is a free-form amount the donor types in, with no catalog
-- item/animation tier attached.
CREATE TABLE donations (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    donor_id              UUID NOT NULL REFERENCES users(id),
    creator_id            UUID NOT NULL REFERENCES users(id),
    stream_id             UUID NOT NULL REFERENCES streams(id),
    amount_santim         INTEGER NOT NULL CHECK (amount_santim > 0),
    message               VARCHAR(200),
    is_anonymous          BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_donations_stream ON donations (stream_id);
CREATE INDEX idx_donations_creator_created ON donations (creator_id, created_at DESC);

-- A creator opts a specific stream into PPV at go-live (see streams/
-- service.ts's goLive) — not a standing per-creator setting, since
-- whether a given broadcast is ticketed is a per-event decision.
ALTER TABLE streams ADD COLUMN is_ppv BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE streams ADD COLUMN ppv_price_santim INTEGER CHECK (ppv_price_santim IS NULL OR ppv_price_santim > 0);

-- One purchase per (stream, buyer) — re-fetching the stream doesn't need a
-- new purchase, see kyc/service.ts's getKycDocumentUrl for the same
-- "prove you already own this" re-check pattern applied to a different
-- resource. access_token_jti records the jti of the JWT issued at
-- purchase time (apps/api/src/streams/ppv-service.ts) purely for audit —
-- verifying a presented token still re-checks this table by (streamId,
-- buyerId), not by jti, since a legitimate re-issued token for the same
-- already-owned purchase is fine.
CREATE TABLE ppv_purchases (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    stream_id             UUID NOT NULL REFERENCES streams(id),
    buyer_id              UUID NOT NULL REFERENCES users(id),
    amount_santim         INTEGER NOT NULL CHECK (amount_santim > 0),
    access_token_jti      UUID NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (stream_id, buyer_id)
);
