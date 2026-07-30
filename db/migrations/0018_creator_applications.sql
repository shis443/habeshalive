-- A.4 launch gate: streaming on Birq requires an approved application while
-- the platform is capped to an initial batch of creators. Default
-- mechanism per the spec's own [CONFIRM]: application + manual admin
-- review, not invite codes — this table structure supports adding invite
-- codes later without a redesign if that changes.
CREATE TABLE creator_applications (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    applicant_id      UUID NOT NULL REFERENCES users(id),
    application_text  TEXT NOT NULL,
    social_links      TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer_id       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_creator_applications_status ON creator_applications (status, created_at);
-- One pending application per user at a time — re-applying after a
-- rejection is fine (a new row), stacking multiple pending ones isn't.
CREATE UNIQUE INDEX idx_creator_applications_one_pending ON creator_applications (applicant_id)
    WHERE status = 'pending';

-- The cap itself, same "admin-editable, no deploy needed" pattern as every
-- other platform_config field (Settings page already renders this table).
ALTER TABLE platform_config ADD COLUMN approved_creator_cap INTEGER NOT NULL DEFAULT 100;

-- Grandfather every account that already has a creator_profiles row —
-- they had streaming access before this gate existed; without this,
-- deploying the gate would lock out real, already-streaming accounts as a
-- side effect of a launch-scoping decision that postdates them.
INSERT INTO creator_applications (applicant_id, application_text, status, reviewed_at)
SELECT user_id, 'Grandfathered — had a creator profile before the application gate existed.', 'approved', now()
FROM creator_profiles;
