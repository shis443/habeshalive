-- T5. Leaderboards and rankings.
--
-- One row per (subject, board, window). Rebuildable: delete a window's
-- slot and recompute it from ledger_entries and stream_viewer_samples /
-- stream_watch_time_daily without touching anything else — no running
-- counter anywhere in this table, per the standing ground rule that a
-- counter is a second source of truth and it will drift.
CREATE TABLE leaderboard_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    board           VARCHAR(24) NOT NULL
                        CHECK (board IN ('top_gifters','top_streamers_revenue',
                                         'top_streamers_watchtime','top_streamers_ccu')),
    window_kind     VARCHAR(10) NOT NULL
                        CHECK (window_kind IN ('daily','weekly','monthly','alltime')),
    -- Window start in Africa/Addis_Ababa. Storing the boundary rather
    -- than a label means "week 37" is never ambiguous across a DST or
    -- year edge, and two servers can't disagree about which week it is.
    -- 'alltime' has no real boundary — it always uses the fixed sentinel
    -- ALLTIME_WINDOW_START ('1970-01-01', see viewer-samples/leaderboard-
    -- service.ts) so every window_kind shares the same NOT NULL column
    -- rather than needing a nullable special case.
    window_start    DATE NOT NULL,
    subject_id      UUID NOT NULL REFERENCES users(id),
    rank            INTEGER NOT NULL CHECK (rank > 0),
    -- Santim for the money boards, seconds for watchtime, viewers for
    -- CCU. One column, because a board never mixes units.
    value           BIGINT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_leaderboard_slot
    ON leaderboard_snapshots (board, window_kind, window_start, subject_id);
-- The read path: "give me the top 100 of this board for this window."
CREATE INDEX idx_leaderboard_read
    ON leaderboard_snapshots (board, window_kind, window_start, rank);
