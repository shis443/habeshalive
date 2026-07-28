-- Creators: account suspension distinct from a moderation ban/timeout —
-- revokes streaming and payout privileges specifically, not chat/gifting
-- (is_banned already covers the "kicked off the platform entirely" case).
ALTER TABLE users ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;

-- Boosts: pricing moves out of hardcoded constants so an admin can change
-- it without a code deploy — the first fields of what becomes the wider
-- Settings table later. Singleton row, enforced at the DB level (id must
-- be TRUE, and TRUE is the primary key, so a second row can't exist).
CREATE TABLE platform_config (
    id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    boost_price_santim  BIGINT NOT NULL DEFAULT 5000,
    boost_duration_ms   BIGINT NOT NULL DEFAULT 3600000,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES users(id)
);
INSERT INTO platform_config (id) VALUES (TRUE);

-- Boosts: manual cancel (refund scenarios) needs somewhere to record it
-- happened, same reasoning as payouts.rejected_by.
ALTER TABLE stream_boosts ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE stream_boosts ADD COLUMN cancelled_by UUID REFERENCES users(id);
