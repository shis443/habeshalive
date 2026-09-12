-- Durable intent for emergency stream controls.
--
-- WHY THIS EXISTS: forceEndStream (streams/service.ts) marked a stream
-- 'ended' in Postgres and returned { ok: true } without ever contacting the
-- media server. The encoder stayed connected, SRS kept ingesting, HLS kept
-- cutting segments — the row said ended, the admin saw success, and the
-- broadcast continued. A moderation control that reports success while doing
-- nothing is the worst failure mode a safety tool has.
--
-- Recording the *intent* first, separately from the enforcement, is what
-- makes an honest answer possible: the row survives an SRS outage, a
-- reconciler can retry, and enforced_at stays NULL until the media server
-- actually confirms. The admin UI reads that difference as "requested" vs
-- "ended" rather than guessing.
--
-- NOTE ON NUMBERING: the architecture blueprint drafted this as 0055. It is
-- applied first because it is the fix for the Sev 1 defect, and migrations
-- here are forward-only and sequential. The remaining blueprint migrations
-- shift accordingly.
CREATE TABLE stream_controls (
    stream_id        UUID PRIMARY KEY REFERENCES streams(id) ON DELETE CASCADE,
    killed           BOOLEAN NOT NULL DEFAULT FALSE,
    chat_muted       BOOLEAN NOT NULL DEFAULT FALSE,
    bitrate_cap_kbps INTEGER CHECK (bitrate_cap_kbps IS NULL OR bitrate_cap_kbps > 0),
    ingest_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
    -- NOT NULL, not merely conventional: every emergency control is an
    -- action someone must later be able to justify. Ground rule 3.
    reason           TEXT NOT NULL,
    applied_by       UUID NOT NULL REFERENCES users(id),
    -- NULL until the media server confirms the kill. Never set optimistically.
    enforced_at      TIMESTAMPTZ,
    -- Last enforcement failure, kept so the admin sees *why* it is still
    -- pending rather than an unexplained "requested".
    last_error       TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reconciler's work queue: controls whose intent has not yet been
-- enforced. Partial, so it stays small regardless of table size.
CREATE INDEX idx_stream_controls_unenforced
    ON stream_controls (created_at) WHERE enforced_at IS NULL;
