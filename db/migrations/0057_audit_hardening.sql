-- Admin audit hardening — Sev 2 from the architecture review. Does NOT
-- include stream_controls (shipped already as 0050, pulled forward during
-- T0 because the kill-switch fix needed durable intent as its mechanism,
-- not as a later nice-to-have — see that migration for its real shape).

ALTER TABLE admin_actions
    ADD COLUMN actor_ip      INET,
    ADD COLUMN actor_session UUID REFERENCES sessions(id),
    -- Before/after as a pair, not one opaque blob: "what changed" is the
    -- question every audit asks, and a single metadata column can't answer
    -- it without the reader already knowing that action's own shape.
    ADD COLUMN before_state  JSONB,
    ADD COLUMN after_state   JSONB;

-- Append-only. Without this the audit trail is advisory: anyone who can
-- reach the database can rewrite the record of what they did. Tamper-
-- EVIDENT, not tamper-proof — a superuser can still drop the trigger, and
-- that action is itself logged by Postgres. Shipping logs to append-only
-- external storage is the next step, not a replacement for this one.
--
-- ONE escape hatch: a session-local GUC, off by default, that must be
-- explicitly SET for the current transaction to bypass this. Found
-- necessary, not merely convenient, by actually running the existing test
-- suite against this migration: apps/api/src/test/fixtures.ts's
-- cleanupTestUsers deletes admin_actions rows for a test user before
-- deleting the user itself (actor_id has no ON DELETE CASCADE — the same
-- reason this function exists at all, a plain REFERENCES that could
-- otherwise be routed around). With no bypass, EVERY one of the 27 test
-- files using that fixture breaks the moment a test user's actions ever
-- reach admin_actions, which most eventually do. No request-handling code
-- anywhere in apps/api/src sets this GUC; only test fixtures do. A
-- production caller would have to deliberately run
-- `SET LOCAL app.allow_admin_actions_delete = 'on'` before the mutation to
-- use it — the same "superuser can still drop the trigger" caveat above,
-- not a new class of hole.
CREATE OR REPLACE FUNCTION admin_actions_append_only() RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.allow_admin_actions_delete', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'admin_actions is append-only (attempted % on %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_actions_no_mutate
    BEFORE UPDATE OR DELETE ON admin_actions
    FOR EACH ROW EXECUTE FUNCTION admin_actions_append_only();

-- Reason required for the actions with real legal/operational weight —
-- pulled forward from the blueprint's originally-proposed 0050 (now
-- renumbered 0052, tax/payout instruments) because it's an audit-integrity
-- concern, not a payments one, and belongs with this migration's own
-- acceptance test.
--
-- Action strings below are the REAL ones in apps/api/src, verified against
-- every actual logAdminAction call site before writing this — the
-- blueprint's first draft guessed 'user.suspend' and 'stream.kill', and
-- neither exists; the real names are 'creator.suspend' and
-- 'stream.force_end'. A CHECK naming actions nobody ever calls enforces
-- nothing.
--
-- stream.mute_chat and stream.revoke_ingest are new in this same change.
-- stream.cap_bitrate is deliberately NOT here, and not built: SRS's admin
-- API has no per-client bitrate control of any kind (verified against
-- every handler class in infra/srs/vendor/trunk/src/app/srs_app_http_api.hpp
-- — clients supports list/delete only), and there is no other channel to
-- the encoder in this stack. stream_controls.bitrate_cap_kbps exists in
-- the schema (0050) but nothing reads or enforces it; wiring an admin
-- button to a column nothing acts on would be exactly the "reports
-- success while doing nothing" defect T0 exists to remove, aimed at a new
-- target. Left for whenever a real enforcement mechanism exists.
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_reason_required
    CHECK (reason IS NOT NULL OR action NOT IN (
        'user.ban', 'user.unban', 'creator.suspend',
        'stream.force_end', 'stream.mute_chat', 'stream.unmute_chat', 'stream.revoke_ingest',
        'payout.reject', 'kyc.reject'
    ));
