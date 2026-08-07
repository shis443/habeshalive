-- Module 1.4: KYC (Fayda Digital ID / Kebele ID) submission + admin review
-- — see apps/api/src/kyc/service.ts. One row per submission attempt, not a
-- single mutable "kyc status" column on users, so a rejected-then-resubmitted
-- history stays inspectable — same reasoning as security_events
-- (0031_security_events.sql). "Current" status for a user is always the
-- most recent row.
CREATE TABLE kyc_submissions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id_type           VARCHAR(20) NOT NULL CHECK (id_type IN ('fayda', 'kebele')),
    -- Object storage key (common/object-storage.ts), never a public URL —
    -- reviewed via a short-lived signed URL (getSignedVodUrl), same
    -- never-public-bucket posture as stream_vods.playback_url. Shares the
    -- VOD bucket (no separate KYC bucket is provisioned) — a distinct
    -- "kyc/" key prefix keeps it logically separate; still private and
    -- signed-URL-only, not public either way.
    document_key      TEXT NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason  TEXT,
    reviewed_by       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_submissions_user_submitted ON kyc_submissions (user_id, submitted_at DESC);
CREATE INDEX idx_kyc_submissions_pending ON kyc_submissions (submitted_at) WHERE status = 'pending';

-- Admin-toggleable, defaults OFF — see admin/config-service.ts's
-- getKycRequiredForPayouts(). Adding a payout gate that's hard-on by
-- default would instantly block every existing creator's withdrawals the
-- moment this migration + the requestPayout check both deploy, before any
-- admin has actually reviewed anyone's ID. An admin flips this on from
-- Admin Settings once the review queue is actually being worked.
ALTER TABLE platform_config ADD COLUMN kyc_required_for_payouts BOOLEAN NOT NULL DEFAULT false;
