-- Module 5 (Moderation/Governance).
--
-- 1. Multi-script blocklist — moderation/service.ts's scanText() was
-- already script-agnostic (Unicode \p{L}/\p{N} boundary matching, not
-- ASCII \b), and blocklist_terms.language was already a plain column,
-- not something the matching logic special-cased on. The only actual
-- Amharic-only constraint was this CHECK — widened here to admit Oromo
-- ('om'), Somali ('so'), and Latin-transliterated Amharic ('am-latn',
-- e.g. "lij" for ልጅ — a real, common way Amharic gets typed casually).
-- Deliberately seeded with ZERO terms for these three, unlike
-- 0016_amharic_blocklist.sql's small starter set: getting a self-harm-
-- incitement phrase or slur WRONG in a language this assistant isn't
-- confident in translating/transliterating accurately is a real harm on
-- its own, worse than shipping an empty list. Real terms go in through
-- the already-built admin Blocklist page (BlocklistManager.tsx),
-- reviewed by an actual speaker — same as 0016's own "needs native-
-- speaker review" note, just not attempting a starter guess this time.
ALTER TABLE blocklist_terms DROP CONSTRAINT blocklist_terms_language_check;
ALTER TABLE blocklist_terms ADD CONSTRAINT blocklist_terms_language_check
    CHECK (language IN ('en', 'am', 'om', 'so', 'am-latn'));

-- 2. Per-channel moderator RBAC — role_permission_grants
-- (0027_permission_grants.sql) is platform-wide only (keyed on
-- users.role); this is the missing "creator X grants viewer Y moderator
-- powers on X's channel specifically" layer chat/service.ts's
-- assertCanModerateStream already had a slot for (it already checks
-- "is the stream owner OR platform staff" — this adds a third check
-- alongside those two, not a replacement for either).
CREATE TABLE channel_moderator_grants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (creator_id, moderator_id)
);
CREATE INDEX idx_channel_moderator_grants_moderator ON channel_moderator_grants (moderator_id);

-- Channel-scoped block — deliberately separate from users.is_banned
-- (platform-wide). A channel moderator/creator can block a viewer from
-- THIS creator's chat only; a platform-wide ban is still admin/mod-only
-- (moderation/actions-service.ts's banUser, unchanged).
CREATE TABLE channel_blocks (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_by        UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (creator_id, blocked_user_id)
);
CREATE INDEX idx_channel_blocks_creator ON channel_blocks (creator_id);

-- 3. Avatar photo upload — reuses the existing image-moderation path
-- (moderation/image-moderation-client.ts's Rekognition integration,
-- already wired to stream thumbnails) rather than a separate mechanism;
-- 'avatar_photo' is a new moderation_flags.content_type value for it.
ALTER TABLE moderation_flags DROP CONSTRAINT moderation_flags_content_type_check;
ALTER TABLE moderation_flags ADD CONSTRAINT moderation_flags_content_type_check
    CHECK (content_type IN ('stream_title', 'gift_message', 'chat_message', 'stream_thumbnail', 'donation_message', 'avatar_photo'));

-- Otherwise needs no new table — users.avatar_url
-- (0001_init.sql) already stores an arbitrary relative path
-- (/avatars/render/:userId.svg today), and chat_messages.is_deleted
-- (0001_init.sql) already exists and is already read-filtered by
-- chat/service.ts's getChatHistory — this migration just adds the two
-- tables above; both those other pieces reuse existing schema.
