-- T4. Watch counting.
--
-- streams.peak_viewers cannot produce watch time or a CCU curve — it's a
-- single running max, not a time series. Sampling every live room at a
-- fixed cadence gives both: SUM(viewer_count) * sample interval is
-- viewer-seconds (watch time with no per-viewer tracking — also the
-- cheapest position under GDPR), and the raw rows are the CCU curve.
CREATE TABLE stream_viewer_samples (
    stream_id       UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    sampled_at      TIMESTAMPTZ NOT NULL,
    viewer_count    INTEGER NOT NULL CHECK (viewer_count >= 0),
    PRIMARY KEY (stream_id, sampled_at)
);
-- At a 60s cadence, SUM(viewer_count) * 60 is viewer-seconds for the
-- stream — watch time without tracking any individual viewer.
CREATE INDEX idx_viewer_samples_time ON stream_viewer_samples (sampled_at);

-- Retention: raw samples older than 90 days are rolled into this daily
-- aggregate and dropped (apps/api/src/streams/viewer-samples-service.ts's
-- rollupStaleViewerSamples), not deleted outright — the aggregate is kept
-- indefinitely for T5/T6's leaderboard and analytics reads. "day" is the
-- Africa/Addis_Ababa calendar day each sample's (UTC-stored) sampled_at
-- falls on — ground rule 8, all window boundaries are Addis time.
CREATE TABLE stream_watch_time_daily (
    stream_id           UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    day                 DATE NOT NULL,
    sample_count        INTEGER NOT NULL CHECK (sample_count > 0),
    viewer_seconds       BIGINT NOT NULL CHECK (viewer_seconds >= 0),
    peak_viewer_count    INTEGER NOT NULL CHECK (peak_viewer_count >= 0),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (stream_id, day)
);
