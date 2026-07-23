-- Platform wallet is a ledger singleton. Postgres UNIQUE constraints don't
-- deduplicate NULL owner_id, so it must be seeded once here rather than
-- lazily created at runtime (which would race under concurrent requests).
INSERT INTO wallets (owner_type, owner_id, currency)
SELECT 'platform', NULL, 'ETB'
WHERE NOT EXISTS (
    SELECT 1 FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB'
);

INSERT INTO wallet_balances_cache (wallet_id, balance_santim)
SELECT id, 0 FROM wallets
WHERE owner_type = 'platform' AND currency = 'ETB'
  AND id NOT IN (SELECT wallet_id FROM wallet_balances_cache);

-- Gift catalog matching the approved Watch page design (obsidian_watch_experience).
INSERT INTO gift_types (name, price_santim, animation_key)
SELECT * FROM (VALUES
    ('Buna', 500, 'buna'),
    ('Injera', 2000, 'injera'),
    ('Lion', 10000, 'lion'),
    ('Crown', 50000, 'crown')
) AS seed(name, price_santim, animation_key)
WHERE NOT EXISTS (SELECT 1 FROM gift_types);
