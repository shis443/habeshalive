-- Build 3 — Birq Plus's "global emote slot" perk (Twitch Turbo-style: a
-- subscriber can contribute up to N custom emotes to the platform-wide
-- catalog; once admin-approved, they're usable by EVERY chatter, not a
-- personal restricted whitelist — that's the real shape of the spec's
-- "global emote slot" language). No separate per-user "equip" table:
-- created_by + a per-creator slot cap (platform_config's new
-- birq_plus_emote_slot_count, checked at upload time in
-- emotes/service.ts) is enough — inventing a second table to track
-- "equipped" state a global catalog doesn't need would just be new infra
-- for a concept the spec doesn't actually ask for.
--
-- Same approve/reject-with-reason review-queue shape as
-- kyc_submissions (0032_kyc.sql): status/rejection_reason/reviewed_by/
-- reviewed_at, not a delete-on-reject — a creator can see why their
-- submission was rejected instead of it silently vanishing.
CREATE TABLE emotes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Chat's :code: token — letters/digits/underscore only so parsing a
    -- message for tokens can't be confused by emote codes containing the
    -- delimiter itself or other markup-sensitive characters.
    code             VARCHAR(32) NOT NULL UNIQUE CHECK (code ~ '^[a-zA-Z0-9_]{2,32}$'),
    image_key        TEXT NOT NULL,
    created_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by      UUID REFERENCES users(id),
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emotes_status ON emotes (status);
CREATE INDEX idx_emotes_created_by ON emotes (created_by);

-- Tunable like every other platform_config numeric, not hardcoded —
-- checked in emotes/service.ts's enqueueEmote against a live COUNT of
-- that creator's own non-rejected emotes.
ALTER TABLE platform_config ADD COLUMN birq_plus_emote_slot_count INTEGER NOT NULL DEFAULT 5;
