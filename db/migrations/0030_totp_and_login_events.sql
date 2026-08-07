-- TOTP 2FA (RFC 6238) + login/device auditing — see apps/api/src/auth/
-- totp.ts (hand-rolled HOTP/TOTP, verified against RFC 4226's own
-- Appendix D test vectors) and totp-service.ts.

-- One row per user, created on /2fa/setup (enabled=false, a pending
-- secret the user hasn't confirmed with a real code yet) and flipped to
-- enabled=true only by /2fa/confirm actually validating a code against
-- it — never trust "the user says they scanned the QR code," only a
-- real generated code proves the secret round-tripped into a real
-- authenticator app.
CREATE TABLE user_totp (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted  TEXT NOT NULL,
    enabled           BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at      TIMESTAMPTZ
);

-- device_fingerprint here is honestly scoped: a hash of IP + User-Agent,
-- not canvas/font/WebGL client-side fingerprinting (that needs frontend
-- instrumentation and/or a third-party SDK like FingerprintJS — a real,
-- separate feature, not silently substituted for here). Good enough to
-- recognize "have we seen this IP+browser combination for this user
-- before" for a new-device login email, not a strong anti-fraud signal
-- on its own.
CREATE TABLE login_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address          TEXT,
    user_agent          TEXT,
    device_fingerprint  TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_events_user_fingerprint ON login_events (user_id, device_fingerprint);
