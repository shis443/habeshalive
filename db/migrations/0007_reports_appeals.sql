-- User-submitted reports (distinct from moderation_flags, which is the
-- automated blocklist scan) and appeals against a ban. moderation_actions
-- already existed in the schema (ban/timeout/unban/delete_message) but had
-- no endpoint ever writing to it — this migration doesn't change that
-- table, the ban/unban endpoints added alongside this just start using it.
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id     UUID NOT NULL REFERENCES users(id),
    target_type     VARCHAR(20) NOT NULL CHECK (target_type IN ('stream','user','gift_message')),
    target_id       UUID NOT NULL,
    reason          VARCHAR(30) NOT NULL CHECK (reason IN ('harassment','hate_speech','spam','nudity','other')),
    details         VARCHAR(500),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','actioned','dismissed')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status ON reports (status, created_at);

-- Appeals are against a ban specifically (the one enforcement state this
-- pass wires end-to-end — see apps/api/src/app.ts's authenticate decorator
-- for where is_banned is actually enforced). One row per appeal attempt;
-- a user can submit a new one if a previous appeal was denied.
CREATE TABLE appeals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    reason          VARCHAR(1000) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appeals_status ON appeals (status, created_at);
