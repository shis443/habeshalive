-- T7. Payout instruments and tax profiles — needed before the first real
-- payout run, not before the trial.
--
-- Tax status is per creator, versioned: a creator who moves between
-- residencies keeps the old row for the periods it applied to, because
-- historical payouts must remain explainable under the rules in force
-- when they were made. Ethiopian withholding is the primary case
-- (Birq pays creators in ETB); W-8BEN is the diaspora path, not assumed
-- to be the default the way a US-first design would.
CREATE TABLE creator_tax_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    residency           VARCHAR(20) NOT NULL
                            CHECK (residency IN ('et_resident','diaspora','other')),
    -- Ethiopian TIN for residents; NULL for diaspora filing W-8BEN.
    tin                 VARCHAR(20),
    form_type           VARCHAR(10)
                            CHECK (form_type IN ('none','w8ben','w9')),
    form_document_key   TEXT,          -- private bucket, signed-URL review only
    withholding_bps     INTEGER NOT NULL DEFAULT 0
                            CHECK (withholding_bps BETWEEN 0 AND 10000),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','verified','rejected','expired')),
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to        TIMESTAMPTZ,   -- NULL = currently in force
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one in-force profile per creator.
CREATE UNIQUE INDEX idx_tax_profile_current
    ON creator_tax_profiles (creator_id) WHERE effective_to IS NULL;

-- A payout instrument is bound once, verified once, and reused — instead
-- of retyping an account number into every payout request, which is both
-- a fraud surface and an operational error source. This closes a real,
-- live gap: payouts.destination (below) has stored a creator's FULL
-- account/telebirr number as plaintext since T0, and the admin UI has
-- displayed it unmasked the whole time. Confirmed with the user before
-- migrating the existing single-payout flow onto this table, since it
-- changes how requestPayout has worked since it was first built.
--
-- "processor_token" in the original blueprint assumed a real tokenized-
-- recipient API. Checked: Chapa's own client here (wallet/chapa-client.ts)
-- has no such endpoint — initiateTransfer takes a raw account number on
-- every call, the norm for bank-transfer APIs (unlike card networks,
-- there is usually no reusable token). So the account number genuinely
-- has to live somewhere to be reused across payouts; encrypted_account_number
-- stores it via the same encryptSecret()/decryptSecret() this codebase
-- already uses for creator_profiles.stream_key, decrypted only inside the
-- activity that actually calls Chapa (wallet/temporal/activities.ts),
-- never returned by any API response and never passed through a Temporal
-- workflow input (which Temporal durably persists in its own event
-- history — passing plaintext through there would undo the point of
-- encrypting it here at all).
CREATE TABLE payout_instruments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'wire' dropped from the blueprint's own set — this platform has no
    -- wire-transfer path anywhere (payoutMethodSchema is telebirr/bank
    -- only); the code wins over the blueprint's speculative third method.
    method              VARCHAR(20) NOT NULL
                            CHECK (method IN ('telebirr','bank')),
    -- Never the full account number. Display tail only.
    display_tail        VARCHAR(8)  NOT NULL,
    account_holder      VARCHAR(120) NOT NULL,
    bank_code           VARCHAR(20),
    encrypted_account_number TEXT NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'unverified'
                            CHECK (status IN ('unverified','verified','failed','retired')),
    -- Cooling-off: a freshly bound instrument cannot receive a payout for
    -- 72h. Standard account-takeover mitigation — the attacker's window
    -- closes before the money moves.
    usable_from         TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '72 hours',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at         TIMESTAMPTZ,
    verified_by         UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_payout_instrument_default
    ON payout_instruments (creator_id) WHERE status = 'verified';
CREATE INDEX idx_payout_instruments_creator ON payout_instruments (creator_id);
