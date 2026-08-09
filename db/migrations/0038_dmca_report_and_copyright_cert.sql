-- DMCA/copyright infrastructure — a real "copyright" report reason
-- feeding the existing reports/moderation queue, plus a per-broadcast
-- creator certification record. Deliberately NOT a legal-text feature:
-- no Terms-of-Service language, no automated takedown/counter-notice
-- workflow, no claim of DMCA Safe Harbor compliance is made here — this
-- is just the data layer a real DMCA process needs (a distinguishable
-- report category, and proof a creator affirmatively certified per
-- broadcast), which a human/legal review can build a real policy on top
-- of.

ALTER TABLE reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check
    CHECK (reason IN ('harassment', 'hate_speech', 'spam', 'nudity', 'copyright', 'other'));

-- Set once per broadcast (goLive's browser-initiated path only — the raw
-- RTMP auto-start path has no UI to present this to, same asymmetry that
-- already exists for title/thumbnail/category on that path). NULL means
-- "not certified" — either the raw-RTMP path, or a pre-existing stream
-- row from before this migration; never backfilled/assumed true.
ALTER TABLE streams ADD COLUMN copyright_certified_at TIMESTAMPTZ;
