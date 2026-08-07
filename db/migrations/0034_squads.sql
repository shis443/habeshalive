-- Module 3 (Broadcasting Infra & Apps) — squad co-streaming, scoped as
-- grid-view orchestration over already-independently-live streams (see
-- apps/api/src/streams/squad-service.ts's own comment): no new real-time
-- media infra, a squad is just a small group of creators whose current
-- live streams get shown together. member rows are keyed by creator_id,
-- not a snapshotted stream_id, so the grid always reflects whichever
-- stream is currently live for that member (a member ending and
-- restarting their stream mid-squad doesn't need to rejoin).
CREATE TABLE squads (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(80),
    invite_code  VARCHAR(10) NOT NULL UNIQUE,
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at     TIMESTAMPTZ
);

CREATE TABLE squad_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    squad_id    UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at     TIMESTAMPTZ
);

-- A creator can only be actively in one squad at a time — enforced here,
-- not just in application code, since two concurrent join calls could
-- otherwise both succeed.
CREATE UNIQUE INDEX idx_squad_members_one_active_per_creator
    ON squad_members (creator_id) WHERE left_at IS NULL;
CREATE INDEX idx_squad_members_squad_active ON squad_members (squad_id) WHERE left_at IS NULL;
