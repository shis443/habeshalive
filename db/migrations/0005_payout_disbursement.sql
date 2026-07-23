-- Real Chapa transfer disbursement needs a bank_code (Chapa's own bank
-- directory, GET /v1/banks — "bank"-method payouts must supply one, since
-- a raw account number alone doesn't identify which bank to send it to;
-- "telebirr" payouts resolve their bank_code by name lookup instead, see
-- apps/api/src/wallet/chapa-client.ts), plus a place to record Chapa's own
-- reference for the transfer and why it failed, if it did.
ALTER TABLE payouts
    ADD COLUMN bank_code TEXT,
    ADD COLUMN chapa_reference TEXT,
    ADD COLUMN failure_reason TEXT;
