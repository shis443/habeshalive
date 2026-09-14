-- Publish-to-profile parity: VODs already have is_published
-- (0028_vod_publish_workflow.sql); clips never got the equivalent, so a
-- combined "published VODs + clips" profile post grid has no single flag
-- to filter clips on. Unlike VODs (which default unpublished — an
-- automatic per-stream recording, not a deliberate creator action), a
-- clip already requires the creator to deliberately pick a start/duration
-- and click Create — treating that as "published" preserves today's real
-- behavior (every existing clip is already public with no draft state).
-- New column defaults TRUE and every existing row is explicitly backfilled
-- to TRUE so no currently-public clip silently vanishes from a shared
-- link or a creator's public Clips tab the moment this migration runs;
-- createClip (vods/clip-service.ts) keeps inserting TRUE going forward.
-- A creator can still explicitly unpublish one via the new
-- publishClip/unpublishClip pair, same shape as the VOD equivalent.
ALTER TABLE clips ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT TRUE;

-- Watermarked-download background job queue (streams/download-service.ts)
-- — burning "Birq.live / @handle" into a full VOD (up to the ~12h reaper
-- ceiling) or clip via ffmpeg is too slow to run inside a request/response
-- cycle, so this is polled and processed out-of-band, same "queue table +
-- setInterval sweep" shape as every other background job in this
-- codebase (no message-broker dependency).
--
-- content_id is polymorphic (a stream_vods.id or clips.id depending on
-- content_type) — no FK, since it can't reference two different tables;
-- ownership/existence is checked in application code at enqueue time.
CREATE TABLE download_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type    VARCHAR(4) NOT NULL CHECK (content_type IN ('vod', 'clip')),
    content_id      UUID NOT NULL,
    requested_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    output_key      TEXT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_download_jobs_status ON download_jobs (status, created_at);
