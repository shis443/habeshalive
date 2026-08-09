-- Revocable login sessions — see apps/api/src/auth/session-service.ts.
--
-- Session JWTs (auth/routes.ts's reply.jwtSign calls) are stateless and
-- carry no expiresIn (see app.ts's jwt.register), so on their own they
-- can never be invalidated before a client discards them. This table is
-- what makes "sign out this device" possible at all: each session row's
-- id is embedded in its JWT as the `jti` claim, and app.ts's
-- `authenticate` decorator checks it's still present with revoked_at
-- NULL on every authenticated request. A token issued before this
-- table existed carries no jti and is grandfathered through unchecked
-- rather than treated as suddenly invalid.
--
-- Distinct from login_events (0030_totp_and_login_events.sql), which is
-- an append-only audit trail (new-device email trigger) with no
-- identity link back to a specific still-usable token.
CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address   TEXT,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);

-- Partial index: only active sessions are ever queried by user (the
-- "Active Devices" list and the per-request touchAndCheckSession lookup
-- by id already hits the primary key directly).
CREATE INDEX idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;
