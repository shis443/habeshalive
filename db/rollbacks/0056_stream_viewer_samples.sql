-- Rollback for 0056_stream_viewer_samples.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
DROP TABLE IF EXISTS stream_watch_time_daily;
DROP TABLE IF EXISTS stream_viewer_samples;
