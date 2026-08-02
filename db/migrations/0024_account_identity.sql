-- E.1: username change rate limit (once per 30 days, checked in the service layer).
ALTER TABLE users ADD COLUMN username_changed_at TIMESTAMPTZ;

-- E.1: pending phone/email change, verified via the existing otp_codes flow
-- before it replaces the live value — never swap phone_number/email
-- directly off a bare request.
ALTER TABLE users ADD COLUMN pending_phone_number VARCHAR(20);
ALTER TABLE users ADD COLUMN pending_email VARCHAR(255);

-- E.8: account deletion. Soft-delete with a grace period — deleted_at set
-- on request, cleared on cancel (logging back in during the window).
-- anonymized_at marks when PII was actually scrubbed (happens once the
-- grace period elapses and a reaper job runs it) — kept distinct from
-- deleted_at so "requested deletion" and "PII actually gone" are two
-- different, individually queryable facts.
ALTER TABLE users ADD COLUMN deletion_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN anonymized_at TIMESTAMPTZ;

-- E.3: social login. provider_user_id is the provider's own subject
-- claim (Google's `sub`, Apple's `sub`) — never the email, since Apple's
-- email can be a private-relay address that isn't a stable identifier on
-- its own account-linking-wise (a user can regenerate their relay
-- address), while `sub` never changes for a given app+user.
CREATE TABLE social_accounts (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'apple')),
    provider_user_id  TEXT NOT NULL,
    email             VARCHAR(255),
    linked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);
CREATE INDEX idx_social_accounts_user ON social_accounts(user_id);

-- E.6: notifications.
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(40) NOT NULL,
    title       VARCHAR(140) NOT NULL,
    body        VARCHAR(300),
    link_url    TEXT,
    actor_id    UUID REFERENCES users(id),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread
    ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_all ON notifications(user_id, created_at DESC);

CREATE TABLE notification_preferences (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    live_alerts           BOOLEAN NOT NULL DEFAULT TRUE,
    gursha_received       BOOLEAN NOT NULL DEFAULT TRUE,
    subscription_events   BOOLEAN NOT NULL DEFAULT TRUE,
    payout_events         BOOLEAN NOT NULL DEFAULT TRUE,
    moderation_events     BOOLEAN NOT NULL DEFAULT TRUE,
    gift_card_events      BOOLEAN NOT NULL DEFAULT TRUE,
    marketing             BOOLEAN NOT NULL DEFAULT FALSE
);
