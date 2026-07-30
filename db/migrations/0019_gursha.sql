-- B.1: rebuild gifting as Gursha (ጉርሻ). Zero real gifts_sent rows exist in
-- production (confirmed before writing this), so the old 4-item catalog
-- (Buna/Injera/Lion/Crown at four different price points) can be replaced
-- outright rather than deactivated-and-kept-for-history.
--
-- Pricing [CONFIRM]: not a Twitch-ladder conversion (their 200-sub tier is
-- ~$1,000 USD, meaningless here). Base unit = 2500 santim (25 ETB) per
-- Gursha, anchored on Birq's existing gift price points (25/100/500 ETB
-- were already in play). gifts_sent.quantity (pre-existing column) already
-- multiplies price_santim * quantity, so the suggested 1/5/10/25/50 ladder
-- falls out of that for free: 25/125/250/625/1250 ETB. Custom quantity
-- caps at 100 (2500 ETB) — enforced in the schema, not just the UI.
--
-- gift_types becomes the THEME catalog (all four rows same base price,
-- animation_key doubles as the theme identifier — mulmul bread colors).
-- Real illustrated art isn't available (same "art-blocked, not
-- code-blocked" situation as the avatar system) — animation_key values
-- below map to CSS-styled placeholders client-side, swappable for real
-- assets later without a schema change.
DELETE FROM gift_types;
INSERT INTO gift_types (name, price_santim, animation_key) VALUES
    ('Classic Mulmul', 2500, 'mulmul_classic'),
    ('Golden Mulmul', 2500, 'mulmul_gold'),
    ('Berbere Mulmul', 2500, 'mulmul_berbere'),
    ('Holiday Mulmul', 2500, 'mulmul_holiday');

-- Targeting: NULL = "Gursha to the Community" (existing behavior — visible
-- to the whole stream, unchanged), non-null = "Gursha a specific viewer".
ALTER TABLE gifts_sent ADD COLUMN recipient_id UUID REFERENCES users(id);
ALTER TABLE gifts_sent ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;

-- Gifter badge progression, per (sender, creator) pair — same reasoning as
-- Twitch's channel-scoped bit badges: "top gifter to THIS creator", not a
-- platform-wide leaderboard. Recomputed on every successful Gursha send;
-- see creators-service.ts-adjacent wallet/service.ts for the write path.
CREATE TABLE gifter_badges (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id),
    creator_id            UUID NOT NULL REFERENCES users(id),
    total_gursha_santim   BIGINT NOT NULL DEFAULT 0,
    tier                  VARCHAR(20) NOT NULL DEFAULT 'none'
                              CHECK (tier IN ('none', 'bronze', 'silver', 'gold', 'platinum')),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, creator_id)
);
CREATE INDEX idx_gifter_badges_creator ON gifter_badges (creator_id, total_gursha_santim DESC);
