-- Rollback for 0050_stream_controls.sql.
--
-- NOT applied automatically: db/migrate.mjs is forward-only and has no
-- concept of a down migration (it applies every *.sql in db/migrations in
-- sorted order and records it in schema_migrations). This lives OUTSIDE
-- db/migrations deliberately — a .sql file in that directory would be
-- picked up and applied as a forward migration, dropping the table it is
-- meant to restore.
--
-- To roll back:
--   psql "$DATABASE_URL" -f db/rollbacks/0050_stream_controls.sql
--   psql "$DATABASE_URL" -c "DELETE FROM schema_migrations WHERE name = '0050_stream_controls.sql'"
DROP INDEX IF EXISTS idx_stream_controls_unenforced;
DROP TABLE IF EXISTS stream_controls;
