-- Rollback for 0058_leaderboard_snapshots.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
DROP TABLE IF EXISTS leaderboard_snapshots;
