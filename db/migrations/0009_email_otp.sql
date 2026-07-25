-- Email OTP sign-in, alongside the existing phone OTP flow — same
-- mechanism (6-digit code, 5-minute expiry, 30s resend cooldown), just a
-- second identifier column. Exactly one of phone_number/email must be set
-- per row (never both, never neither).
ALTER TABLE otp_codes
    ALTER COLUMN phone_number DROP NOT NULL,
    ADD COLUMN email VARCHAR(255),
    ADD CONSTRAINT otp_codes_one_identifier CHECK (
        (phone_number IS NOT NULL AND email IS NULL) OR
        (phone_number IS NULL AND email IS NOT NULL)
    );

CREATE INDEX idx_otp_codes_phone ON otp_codes (phone_number, created_at) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_otp_codes_email ON otp_codes (email, created_at) WHERE email IS NOT NULL;
