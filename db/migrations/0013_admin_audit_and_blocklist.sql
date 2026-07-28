-- Unified admin audit log — every admin-triggered mutation writes here
-- going forward, in addition to whatever domain-specific table it also
-- updates (moderation_actions, payouts.approved_by, etc). Those stay the
-- operational record for their own domain; this is the cross-cutting
-- "who did what, when, why" view nothing currently provides.
CREATE TABLE admin_actions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID NOT NULL REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    target_type VARCHAR(30) NOT NULL,
    target_id   TEXT,
    reason      TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_actions_created ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_actor ON admin_actions (actor_id, created_at DESC);

-- Replaces moderation/wordlists.ts's static EN_BLOCKLIST/AM_BLOCKLIST
-- arrays as scanText()'s actual source, so an admin can add/remove terms
-- without a code deploy. Seeded with the exact current EN_BLOCKLIST so
-- flagging behavior doesn't regress the moment this ships; AM_BLOCKLIST
-- was already empty (see wordlists.ts's comment on why), so nothing to
-- seed there.
CREATE TABLE blocklist_terms (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term        TEXT NOT NULL,
    language    VARCHAR(10) NOT NULL CHECK (language IN ('en', 'am')),
    added_by    UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (term, language)
);

-- approvePayout() already had approved_by; rejectPayout() (new) needs the
-- symmetric column so the payout history view can show who rejected a
-- payout without joining admin_actions just for that.
ALTER TABLE payouts ADD COLUMN rejected_by UUID REFERENCES users(id);

INSERT INTO blocklist_terms (term, language) VALUES
    ('fuck', 'en'),
    ('shit', 'en'),
    ('bitch', 'en'),
    ('asshole', 'en'),
    ('bastard', 'en'),
    ('whore', 'en'),
    ('slut', 'en'),
    ('retard', 'en'),
    ('kill yourself', 'en'),
    ('kys', 'en');
