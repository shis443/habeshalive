-- Rollback for 0057_audit_hardening.sql. Not auto-applied — see
-- db/rollbacks/0050_stream_controls.sql for why this lives outside
-- db/migrations/.
ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_reason_required;
DROP TRIGGER IF EXISTS admin_actions_no_mutate ON admin_actions;
DROP FUNCTION IF EXISTS admin_actions_append_only();
ALTER TABLE admin_actions
    DROP COLUMN IF EXISTS actor_ip,
    DROP COLUMN IF EXISTS actor_session,
    DROP COLUMN IF EXISTS before_state,
    DROP COLUMN IF EXISTS after_state;
