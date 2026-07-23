-- Flags (not deletes) user-generated text that matches a blocklist term,
-- for human review. Applied at the two real user-text endpoints that exist
-- today (stream title on go-live, gift message) — chat has no backend
-- endpoint yet to flag from (see docs/architecture.md's Rate limiting
-- section for that gap).
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
