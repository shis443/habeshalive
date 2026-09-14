-- Real gap found during a live admin walkthrough: there was no floor on
-- how small a payout request could be — a creator could request 1 santim.
-- Same tunable-not-hardcoded pattern as payout_manual_review_threshold_santim
-- (0015) — an admin can raise/lower this from Settings with no deploy.
-- 1000 santim (10 ETB) is a deliberately low starting floor — just enough
-- to stop trivial/spam-sized requests, not a business decision about what
-- a "real" minimum payout should be; an admin sets the actual policy.
ALTER TABLE platform_config ADD COLUMN payout_minimum_amount_santim BIGINT NOT NULL DEFAULT 1000;
