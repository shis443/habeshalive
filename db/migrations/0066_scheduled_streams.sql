-- YouTube-style scheduled broadcasts — a creator announces a future
-- stream (title/caption/category/language/scheduled time/thumbnail); the
-- public channel page shows a countdown "Upcoming" card until the real
-- `streams` row for that creator goes live, at which point
-- promoteStartingStreams() (apps/api/src/streams/service.ts) flips this
-- row to 'live' and backfills stream_id.
--
-- A separate table, not a new `streams.status` value: `streams` represents
-- an actual ingest session (a real playback_url, a real SRS/WHIP publish),
-- which doesn't exist yet at scheduling time — conflating the two would
-- mean either a fake placeholder streams row or nullable columns across
-- the whole streams table just for the scheduled case.
CREATE TABLE scheduled_streams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(140) NOT NULL,
    caption VARCHAR(500),
    category VARCHAR(50),
    language VARCHAR(30),
    scheduled_at TIMESTAMPTZ NOT NULL,
    -- Same "data: URI or real URL, stored as-is" convention as
    -- streams.thumbnail_url (createStreamSchema) — no object-storage
    -- upload plumbing needed for this either.
    thumbnail_url TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'live', 'cancelled')),
    stream_id UUID REFERENCES streams(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One pending schedule per creator at a time — submitting a new one while
-- another is still pending replaces it (see scheduled-service.ts), rather
-- than the ambiguity of which of several would actually convert on the
-- next go-live.
CREATE UNIQUE INDEX idx_scheduled_streams_one_pending ON scheduled_streams(creator_id)
    WHERE status = 'scheduled';

-- Backs both the public per-creator lookup and the stale-schedule
-- auto-cancel sweep (both filter on status, order/compare on scheduled_at).
CREATE INDEX idx_scheduled_streams_status_time ON scheduled_streams(status, scheduled_at);
