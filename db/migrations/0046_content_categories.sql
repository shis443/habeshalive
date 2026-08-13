-- Flutter-reference UI rebuild — real category catalog. STREAM_CATEGORIES
-- (packages/shared/src/constants.ts) stays the fixed 4-value string list
-- every existing streams.category / category_follows.category column
-- already stores and filters on — this table does NOT replace that or
-- become a hard FK from streams (a much bigger, riskier migration for no
-- real benefit today). Instead content_categories.slug matches those same
-- string values exactly, adding the metadata (description, artwork,
-- ordering, active state) neither of those columns carry. Same
-- match-by-string-value pattern category_follows (0042) already uses.
CREATE TABLE content_categories (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug         VARCHAR(50) NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL,
    description  TEXT,
    -- NULL => the generated-art fallback (deterministic gradient+initial,
    -- see components/CategoryTile.tsx) renders instead. Birq has no
    -- object-storage pipeline wired up anywhere yet (GoLivePanel.tsx's
    -- thumbnailUrl is a client-compressed data: URI for the exact same
    -- reason), so this column exists for when that changes, not filled in
    -- by this migration.
    artwork_url  TEXT,
    sort_order   INT NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Curated tags per category (the reference's tag-chip row on category
-- cards/headers) — a separate table, not a text[] column, so tags stay
-- individually addressable (future per-tag admin edit/reorder) the same
-- way category_tags below models it as real rows, not a delimited string.
CREATE TABLE category_tags (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id  UUID NOT NULL REFERENCES content_categories(id) ON DELETE CASCADE,
    tag          VARCHAR(50) NOT NULL,
    sort_order   INT NOT NULL DEFAULT 0,
    UNIQUE (category_id, tag)
);
CREATE INDEX idx_category_tags_category_id ON category_tags (category_id);

-- Seed: Birq-owned copy written for this platform, not sourced from any
-- third-party app — matches the 4 existing STREAM_CATEGORIES values
-- exactly so every existing stream/category_follows row already lines up
-- with a real catalog row on deploy, with nothing left unmatched.
INSERT INTO content_categories (slug, name, description, sort_order) VALUES
    ('Music', 'Music', 'Live performances, DJ sets, and music sessions from Ethiopian and diaspora artists.', 1),
    ('Gaming', 'Gaming', 'Live gameplay, esports, and gaming commentary.', 2),
    ('Traditional', 'Traditional', 'Traditional Ethiopian music, culture, and storytelling.', 3),
    ('Just Chatting', 'Just Chatting', 'Talk shows, Q&A, and casual conversation with your favorite creators.', 4);

INSERT INTO category_tags (category_id, tag, sort_order)
SELECT id, tag, ord
FROM content_categories,
     LATERAL (VALUES
        ('Music', ARRAY['Live', 'DJ Set', 'Acoustic']),
        ('Gaming', ARRAY['Esports', 'Let''s Play', 'Speedrun']),
        ('Traditional', ARRAY['Culture', 'Folk', 'Storytelling']),
        ('Just Chatting', ARRAY['Talk Show', 'Q&A', 'IRL'])
     ) AS seed(seed_slug, tags)
     CROSS JOIN LATERAL unnest(tags) WITH ORDINALITY AS t(tag, ord)
WHERE content_categories.slug = seed.seed_slug;
