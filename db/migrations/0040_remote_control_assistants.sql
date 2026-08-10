-- Remote control delegation — apps/api/src/remote-control/. Lets a creator
-- grant a producer/co-host browser-based control over their live broadcast
-- (setScene, setMute, ...) without ever sharing their stream_key or account
-- password. See docs/architecture.md's "Remote control" section for the
-- full ticket/relay design this table backs.
--
-- streamer_id is the creator's own user_id, not a separate device
-- identifier — creator_profiles.user_id is that table's primary key (see
-- db/schema.sql), so this references it directly rather than users(id):
-- an assistant grant is only ever meaningful for a user who actually has a
-- creator profile to control.
CREATE TABLE remote_control_assistants (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    streamer_id       UUID NOT NULL REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    assistant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by        UUID NOT NULL REFERENCES users(id),
    granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at        TIMESTAMPTZ,
    UNIQUE (streamer_id, assistant_user_id)
);

-- Only the lookup ticket-service.ts's resolveScope() actually performs:
-- "is this assistant_user_id currently (not revoked) delegated for this
-- streamer_id". Partial index (WHERE revoked_at IS NULL) keeps it small
-- and keeps a revoked grant from ever satisfying this lookup again without
-- needing a second query/filter at read time.
CREATE INDEX idx_rc_assistants_lookup
    ON remote_control_assistants(assistant_user_id, streamer_id)
    WHERE revoked_at IS NULL;
