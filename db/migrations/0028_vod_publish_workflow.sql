-- Adds draft/publish semantics to stream_vods (db/migrations/0001_init.sql),
-- which today has no such concept at all: every row is visible to anyone
-- hitting GET /vods/:username the instant it's INSERTed, and title/
-- thumbnail are always derived from the parent streams row via a JOIN
-- (vods/service.ts's listVodsForCreator), never independently editable.
--
-- is_published defaults to false: createVodFromRecording (the SRS on_dvr
-- webhook path, apps/api/src/streams/routes.ts's /webhooks/vod-ready) now
-- inserts every new recording as an unpublished draft, and a creator has
-- to explicitly publish it (new PATCH /vods/:id/publish route) before it's
-- visible on their channel page or in Explore — matching this feature's
-- whole premise: prompt the creator after their stream ends rather than
-- silently making every recording public.
--
-- title/description/category are independent per-VOD overrides, NOT a
-- duplicate of streams.title/description/category — a creator may want to
-- rename or re-categorize a specific recording before publishing it
-- (e.g. the live stream was titled "!drops incoming" but the VOD should
-- read "Full playthrough — part 3"). NULL means "no override yet", and
-- listVodsForCreator falls back to the parent stream's values in that
-- case — this is additive, not a breaking change to what already reads
-- that JOIN.
ALTER TABLE stream_vods
    ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN title        TEXT,
    ADD COLUMN description  TEXT,
    ADD COLUMN category     VARCHAR(50),
    ADD COLUMN views        INTEGER NOT NULL DEFAULT 0;

-- listVodsForCreator's public path filters on is_published; this index
-- keeps that (and the future admin/dashboard "your draft VODs" query,
-- filtered the other way) from becoming a sequential scan as the table
-- grows past a handful of rows per creator.
CREATE INDEX idx_stream_vods_stream_id_is_published ON stream_vods (stream_id, is_published);
