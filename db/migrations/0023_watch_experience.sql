-- D.1: verified badge. users.is_verified already exists (db/migrations/
-- 0001_init.sql) but was dead schema — never selected, never exposed on
-- any API type, and StreamMeta.tsx rendered the verified checkmark
-- unconditionally for every creator regardless of it. This migration adds
-- no column; D.1's actual work was wiring the existing column through
-- (streams/service.ts, search/service.ts, admin/creators-service.ts,
-- shared schemas, and the frontend's conditional render).

-- D.2: pinned chat message. One active pin per stream — pinning a new
-- message replaces the old pin (upsert on stream_id), rather than
-- stacking pins. Pinner is either the stream's own creator or a platform
-- moderator/admin (enforced in the service layer, not here).
CREATE TABLE pinned_messages (
    stream_id   UUID PRIMARY KEY REFERENCES streams(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id),
    pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- D.2: sender role + subscriber tenure need no new column — same pattern
-- chat_messages.gifter_badge_tier already uses (computed via a live JOIN
-- on every read/insert-return, not stored on the row). users.role and
-- subscriptions.started_at already carry everything needed.

-- D.2: platform-wide announcement banner. Creator-level announcements are
-- out of scope for this pass (see handoff report) — this is the
-- platform-admin-authored case only.
CREATE TABLE announcements (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    body         VARCHAR(280) NOT NULL,
    action_label VARCHAR(40),
    action_url   TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
