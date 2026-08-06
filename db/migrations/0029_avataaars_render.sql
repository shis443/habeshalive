-- Swaps the avatar renderer's flat-swatch placeholder for real layered
-- character art (@dicebear/avataaars — a headless, pure-SVG-string
-- reimplementation of the Pablo Stanley "Avataaars" design, MIT-licensed
-- code + free-for-commercial-use design) — exactly what
-- 0004_avatars.sql's own header comment anticipated: "real layered
-- character art can replace the renderer later without touching this
-- data model." This migration only widens that data model to the real,
-- richer category set the new renderer needs; packages/shared/src/
-- avatarRender.ts is where the actual swap happens.
--
-- Three categories are REPURPOSED, not just added: 'hair', 'eyes', and
-- 'accessories' meant "pick a color dot" before (avatar_parts.name was a
-- human label like 'Warm Brown', swatch_color the only thing that
-- mattered). They now mean "pick a real DiceBear option key" (name holds
-- the literal key, e.g. 'curly' or 'happy', swatch_color is NULL for
-- these rows — see avatarRender.ts for why storing the key in `name`
-- avoids adding a whole new column). An old selection's *row* can't be
-- meaningfully carried forward under the new meaning (a hex color has no
-- sensible mapping to a hairstyle), so existing selections for these
-- three categories are cleared — real accounts that had picked one just
-- fall back to this render's defaults until they revisit /avatar, not a
-- data-loss concern for a cosmetic, freely-re-editable preference.

ALTER TABLE avatar_parts DROP CONSTRAINT avatar_parts_category_check;
ALTER TABLE avatar_parts ADD CONSTRAINT avatar_parts_category_check
    CHECK (category IN (
        'background', 'skin_tone', 'hair', 'hair_color', 'eyes', 'eyebrows',
        'mouth', 'facial_hair', 'accessories', 'clothing', 'clothes_color'
    ));

ALTER TABLE user_avatar_selections DROP CONSTRAINT user_avatar_selections_category_check;
ALTER TABLE user_avatar_selections ADD CONSTRAINT user_avatar_selections_category_check
    CHECK (category IN (
        'background', 'skin_tone', 'hair', 'hair_color', 'eyes', 'eyebrows',
        'mouth', 'facial_hair', 'accessories', 'clothing', 'clothes_color'
    ));

-- Clear selections + catalog rows for the three repurposed categories —
-- see header comment. Deleting user_avatar_selections rows first: part_id
-- has no ON DELETE clause (defaults to RESTRICT), so avatar_parts rows
-- referenced by a real user's selection can't be deleted until that
-- reference is gone.
DELETE FROM user_avatar_selections WHERE category IN ('hair', 'eyes', 'accessories');
DELETE FROM avatar_parts WHERE category IN ('hair', 'eyes', 'accessories');

-- Re-seed background/skin_tone with real DiceBear-compatible hex values
-- (skin_tone's, specifically, are the exact values from the original
-- avataaars design source — verified against the installed
-- @dicebear/avataaars package, not guessed) — old rows kept if already
-- selected by a real user (background/skin_tone weren't repurposed, just
-- getting better values going forward), new ones added alongside.
INSERT INTO avatar_parts (category, name, swatch_color, sort_order)
SELECT * FROM (VALUES
    ('background', 'Sunset',    '#ffb869', 6),
    ('background', 'Aqua',      '#4cd7f6', 7),
    ('background', 'Rose',      '#f2a3c7', 8),

    ('skin_tone', 'Tanned',     '#fd9841', 6),
    ('skin_tone', 'Yellow',     '#f8d25c', 7),
    ('skin_tone', 'Pale',       '#ffdbb4', 8),
    ('skin_tone', 'Light',      '#edb98a', 9),
    ('skin_tone', 'Brown',      '#d08b5b', 10),
    ('skin_tone', 'Dark Brown', '#ae5d29', 11),
    ('skin_tone', 'Black',      '#614335', 12)
) AS seed(category, name, swatch_color, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM avatar_parts p WHERE p.category = seed.category AND p.name = seed.name
);

-- New style categories. name = the literal @dicebear/avataaars option key
-- (verified against the installed package's lib/types.d.ts, not
-- guessed/remembered) — swatch_color NULL throughout, since these pick a
-- shape, not a color; see AvatarPartGrid.tsx for how the frontend
-- distinguishes a color swatch tile from a text-label tile using that.
--
-- Curated subsets, not every option DiceBear ships (it has 37 hair
-- styles alone) — a manageable, still-varied picker rather than an
-- overwhelming wall of near-duplicate options. 'graphicShirt' is
-- deliberately excluded from clothing: it needs a second, conditional
-- "which graphic" picker this pass doesn't build (scoped out, not an
-- oversight — see the feature's own rollout notes).
INSERT INTO avatar_parts (category, name, swatch_color, sort_order)
SELECT * FROM (VALUES
    ('hair', 'curly', NULL, 0),
    ('hair', 'bob', NULL, 1),
    ('hair', 'straight01', NULL, 2),
    ('hair', 'shortRound', NULL, 3),
    ('hair', 'shortFlat', NULL, 4),
    ('hair', 'dreads01', NULL, 5),
    ('hair', 'theCaesar', NULL, 6),
    ('hair', 'bigHair', NULL, 7),
    ('hair', 'fro', NULL, 8),
    ('hair', 'hijab', NULL, 9),
    ('hair', 'turban', NULL, 10),

    ('hair_color', 'Auburn',      '#a55728', 0),
    ('hair_color', 'Black',       '#2c1b18', 1),
    ('hair_color', 'Blonde',      '#b58143', 2),
    ('hair_color', 'Brown',       '#724133', 3),
    ('hair_color', 'Brown Dark',  '#4a312c', 4),
    ('hair_color', 'Platinum',    '#ecdcbf', 5),
    ('hair_color', 'Red',         '#c93305', 6),
    ('hair_color', 'Silver Gray', '#e8e1e1', 7),

    ('eyes', 'default', NULL, 0),
    ('eyes', 'happy', NULL, 1),
    ('eyes', 'side', NULL, 2),
    ('eyes', 'wink', NULL, 3),
    ('eyes', 'squint', NULL, 4),
    ('eyes', 'surprised', NULL, 5),
    ('eyes', 'hearts', NULL, 6),

    ('eyebrows', 'default', NULL, 0),
    ('eyebrows', 'raisedExcited', NULL, 1),
    ('eyebrows', 'sadConcerned', NULL, 2),
    ('eyebrows', 'angry', NULL, 3),
    ('eyebrows', 'upDown', NULL, 4),

    ('mouth', 'smile', NULL, 0),
    ('mouth', 'default', NULL, 1),
    ('mouth', 'twinkle', NULL, 2),
    ('mouth', 'serious', NULL, 3),
    ('mouth', 'tongue', NULL, 4),
    ('mouth', 'concerned', NULL, 5),

    ('facial_hair', 'blank', NULL, 0),
    ('facial_hair', 'beardLight', NULL, 1),
    ('facial_hair', 'beardMedium', NULL, 2),
    ('facial_hair', 'beardMajestic', NULL, 3),
    ('facial_hair', 'moustacheFancy', NULL, 4),

    ('accessories', 'blank', NULL, 0),
    ('accessories', 'round', NULL, 1),
    ('accessories', 'wayfarers', NULL, 2),
    ('accessories', 'sunglasses', NULL, 3),
    ('accessories', 'prescription02', NULL, 4),

    ('clothing', 'shirtCrewNeck', NULL, 0),
    ('clothing', 'hoodie', NULL, 1),
    ('clothing', 'blazerAndShirt', NULL, 2),
    ('clothing', 'collarAndSweater', NULL, 3),
    ('clothing', 'overall', NULL, 4),

    ('clothes_color', 'Black',        '#262e33', 0),
    ('clothes_color', 'Blue',         '#5199e4', 1),
    ('clothes_color', 'Dark Blue',    '#25557c', 2),
    ('clothes_color', 'Gray',         '#929598', 3),
    ('clothes_color', 'White',        '#ffffff', 4),
    ('clothes_color', 'Pink',         '#ff488e', 5),
    ('clothes_color', 'Red',          '#ff5c5c', 6)
) AS seed(category, name, swatch_color, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM avatar_parts p WHERE p.category = seed.category AND p.name = seed.name
);
