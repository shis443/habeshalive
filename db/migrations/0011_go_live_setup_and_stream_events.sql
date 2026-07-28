-- Go Live setup flow: creator_profiles.category already existed but was
-- never written to anywhere (dead column, read by search/follows, always
-- null) — this migration adds its missing counterpart, language, and both
-- get populated for real by goLive() from here on, so the next stream a
-- creator starts can pre-fill the category/language they used last time.
ALTER TABLE creator_profiles ADD COLUMN language VARCHAR(30);

-- Engagement logging groundwork (Section 5) — no ranking/recommendation
-- logic reads this yet, it exists purely so real usage data is available
-- once there's enough of it to learn from. type is free-form-ish but
-- constrained to a known set so a typo'd event type can't silently stop
-- being queryable.
CREATE TABLE stream_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    type        VARCHAR(20) NOT NULL CHECK (type IN ('started', 'ended')),
    category    VARCHAR(50),
    peak_viewers INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stream_events_stream ON stream_events(stream_id);
CREATE INDEX idx_stream_events_type_created ON stream_events(type, created_at);
