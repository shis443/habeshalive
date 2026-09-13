-- T3. Gift catalog and pricing.
--
-- The blueprint that proposed this migration assumed the creator/platform
-- split was a constant in application code. It is not: every gift,
-- donation, subscription and PPV split already reads
-- creator_profiles.revenue_share_bps, a per-creator column an admin can
-- already change without a deploy (admin/creators-service.ts). Confirmed
-- with the user before writing this, since a competing interpretation
-- (gift_types.creator_share_bps overriding the creator's own rate) would
-- be a real change to how real money splits on a live-money platform.
--
-- Decision: gift_types.creator_share_bps and gifts_sent.creator_share_bps
-- are a pure reference/audit pair. Neither drives sendGift's actual split
-- math, which stays exactly what it was before this migration
-- (creator_profiles.revenue_share_bps). gift_types.creator_share_bps is a
-- catalog-level reference value finance can tune for reporting/planning;
-- gifts_sent.creator_share_bps pins the rate that ACTUALLY applied to
-- that specific send, so a later change to a creator's rate can never
-- rewrite what a past gift's payout was actually split at — the one-way-
-- door concern the original brief was really pointing at, just attached
-- to the correct column.
ALTER TABLE gift_types
    ADD COLUMN category          VARCHAR(30) NOT NULL DEFAULT 'classic',
    ADD COLUMN creator_share_bps INTEGER NOT NULL DEFAULT 5000
        CHECK (creator_share_bps BETWEEN 0 AND 10000),
    ADD COLUMN available_from    TIMESTAMPTZ,
    ADD COLUMN available_until   TIMESTAMPTZ,
    -- NULL = available everywhere. ISO-3166-1 alpha-2 codes. Stored and
    -- admin-editable from this migration on, but NOT YET enforced against
    -- a viewer's actual location anywhere in apps/api — there is no
    -- geo-IP or user-country signal in this codebase to filter by, and
    -- adding one is a new dependency this migration does not introduce.
    -- See wallet/service.ts's listGiftTypes for the enforced half
    -- (available_from/available_until) and its comment on this gap.
    ADD COLUMN regions           TEXT[];

ALTER TABLE gifts_sent
    ADD COLUMN creator_share_bps INTEGER
        CHECK (creator_share_bps BETWEEN 0 AND 10000);

-- Backfill from the ledger's own recorded amounts, not from
-- creator_profiles.revenue_share_bps's CURRENT value — that column has no
-- history, so if a creator's rate changed since a past gift was sent,
-- reading it now would silently fabricate what that gift's payout was
-- actually split at. The ledger entries written at send time are the only
-- real source of truth for "what rate actually applied," and this
-- reconstructs it exactly regardless of how many entries the transaction
-- has (works unchanged across the pre- and post-0053 entry shapes, since
-- it just sums by wallet ownership and direction).
UPDATE gifts_sent gs
SET creator_share_bps = ROUND(
    (
      SELECT COALESCE(SUM(le.amount_santim), 0)
      FROM ledger_entries le
      JOIN wallets w ON w.id = le.wallet_id
      WHERE le.ledger_transaction_id = gs.ledger_transaction_id
        AND le.direction = 'credit'
        AND w.owner_type = 'user' AND w.owner_id = gs.creator_id
    )::numeric * 10000 / NULLIF((
      SELECT COALESCE(SUM(le.amount_santim), 0)
      FROM ledger_entries le
      WHERE le.ledger_transaction_id = gs.ledger_transaction_id
        AND le.direction = 'debit'
    ), 0)
)
WHERE gs.creator_share_bps IS NULL;

-- Every row that exists at this point has been backfilled from real
-- ledger amounts above; every row from this point forward is written by
-- wallet/service.ts's sendGift at send time. NOT NULL is safe precisely
-- because of that — there is no third path that inserts a gifts_sent row.
ALTER TABLE gifts_sent ALTER COLUMN creator_share_bps SET NOT NULL;
