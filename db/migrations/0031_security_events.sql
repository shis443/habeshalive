-- Module 1.3: 72-hour payout hold after a security-sensitive account
-- change — see apps/api/src/common/security-hold.ts. One row per event,
-- not a single "last changed at" column on users, so the 72h window is
-- always computed from the most recent real event and old events can be
-- inspected/audited later if a dispute comes up.
CREATE TABLE security_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  VARCHAR(30) NOT NULL CHECK (event_type IN ('password_change', 'totp_enabled', 'totp_disabled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_events_user_created ON security_events (user_id, created_at DESC);
