-- DMCA notice-and-takedown intake — see apps/api/src/dmca/service.ts.
--
-- This is intake, review, and enforcement infrastructure only — it is NOT
-- a legal opinion that the platform's process satisfies DMCA safe-harbor
-- (17 U.S.C. 512) on its own. Real safe-harbor status also requires a
-- registered DMCA agent on file with the U.S. Copyright Office, a public
-- repeat-infringer policy, and (for a platform outside the US) correctly
-- scoping which law actually applies — none of that is a database schema
-- concern, and none of it is asserted here. Get real legal review before
-- relying on this for actual safe-harbor protection.
CREATE TABLE dmca_reports (
    id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_name                 TEXT NOT NULL,
    reporter_email                TEXT NOT NULL,
    content_type                  TEXT NOT NULL CHECK (content_type IN ('vod', 'clip', 'stream')),
    content_id                    UUID NOT NULL,
    content_url                   TEXT,
    copyrighted_work_description  TEXT NOT NULL,
    -- The two statements 17 U.S.C. 512(c)(3) actually requires a takedown
    -- notice to contain: a good-faith belief the use is unauthorized, and
    -- that the notice's information is accurate under penalty of perjury.
    -- Booleans, not free text — the submitter affirmatively checks each,
    -- same evidentiary shape as a checkbox on a real DMCA web form.
    good_faith_statement          BOOLEAN NOT NULL,
    accuracy_statement            BOOLEAN NOT NULL,
    signature                     TEXT NOT NULL,
    status                        TEXT NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'valid', 'invalid', 'counter_noticed', 'reinstated')),
    reviewed_by                   UUID REFERENCES users(id),
    reviewed_at                   TIMESTAMPTZ,
    resolution_notes              TEXT,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dmca_reports_status ON dmca_reports (status);
CREATE INDEX idx_dmca_reports_content ON dmca_reports (content_type, content_id);

-- Counter-notification (17 U.S.C. 512(g)) — the alleged infringer's
-- dispute of a takedown. Real safe-harbor practice is a 10-14 business day
-- wait after this before reinstating (giving the original reporter a
-- window to file suit) — that timer is a resolveDmcaReport()/admin-process
-- concern, not encoded here as a hard constraint.
CREATE TABLE dmca_counter_notices (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dmca_report_id            UUID NOT NULL REFERENCES dmca_reports(id) ON DELETE CASCADE,
    respondent_user_id        UUID NOT NULL REFERENCES users(id),
    respondent_name           TEXT NOT NULL,
    respondent_address        TEXT NOT NULL,
    consent_to_jurisdiction   BOOLEAN NOT NULL,
    good_faith_statement      BOOLEAN NOT NULL,
    signature                 TEXT NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dmca_counter_notices_report ON dmca_counter_notices (dmca_report_id);

-- Enforcement point: a report marked 'valid' sets this, which is what
-- actually gates visibility (see vods/service.ts's public listing query
-- and clips/service.ts's equivalent) — separate from stream_vods'
-- existing is_published (a creator's own draft/publish choice; this is an
-- externally-forced removal that survives even if they'd otherwise
-- publish it).
ALTER TABLE stream_vods ADD COLUMN dmca_removed_at TIMESTAMPTZ;
ALTER TABLE clips ADD COLUMN dmca_removed_at TIMESTAMPTZ;
