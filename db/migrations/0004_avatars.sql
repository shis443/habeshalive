-- Avatar builder: a catalog of parts per category, and one selected part per
-- category per user. Rendering is a server-generated placeholder SVG (flat
-- swatches) for now — real layered character art can replace the renderer
-- later without touching this data model.

CREATE TABLE avatar_parts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category      VARCHAR(20) NOT NULL
                      CHECK (category IN ('background', 'skin_tone', 'hair', 'eyes', 'accessories')),
    name          VARCHAR(50) NOT NULL,
    swatch_color  VARCHAR(7),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_avatar_parts_category ON avatar_parts(category, sort_order);

CREATE TABLE user_avatar_selections (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    VARCHAR(20) NOT NULL
                    CHECK (category IN ('background', 'skin_tone', 'hair', 'eyes', 'accessories')),
    part_id     UUID NOT NULL REFERENCES avatar_parts(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category)
);

INSERT INTO avatar_parts (category, name, swatch_color, sort_order)
SELECT * FROM (VALUES
    ('background', 'None',            NULL,      0),
    ('background', 'Obsidian Black',  '#060e20', 1),
    ('background', 'Midnight Purple', '#3c0091', 2),
    ('background', 'Deep Teal',       '#003640', 3),
    ('background', 'Charcoal',        '#131b2e', 4),
    ('background', 'Warm Ember',      '#ffb869', 5),

    ('skin_tone',  'Default',  '#a0785a', 0),
    ('skin_tone',  'Skin 1',   '#3d2314', 1),
    ('skin_tone',  'Skin 2',   '#8d5524', 2),
    ('skin_tone',  'Skin 3',   '#c68642', 3),
    ('skin_tone',  'Skin 4',   '#e0ac69', 4),
    ('skin_tone',  'Skin 5',   '#f1c27d', 5),

    ('hair', 'None',        NULL,      0),
    ('hair', 'Afro Large',  '#1a1a1a', 1),
    ('hair', 'Box Braids',  '#2b1810', 2),
    ('hair', 'Short Fade',  '#0d0d0d', 3),
    ('hair', 'Curly Bob',   '#4a2c17', 4),
    ('hair', 'Locs',        '#1f1108', 5),

    ('eyes', 'None',        NULL,      0),
    ('eyes', 'Warm Brown',  '#6b4226', 1),
    ('eyes', 'Deep Black',  '#1a1a1a', 2),
    ('eyes', 'Hazel',       '#8b6b3d', 3),
    ('eyes', 'Teal Accent', '#4cd7f6', 4),

    ('accessories', 'None',          NULL,      0),
    ('accessories', 'Purple Hoops',  '#d0bcff', 1),
    ('accessories', 'Teal Studs',    '#4cd7f6', 2),
    ('accessories', 'Silver Chain',  '#c0c0c0', 3),
    ('accessories', 'Glasses',       '#2d3449', 4)
) AS seed(category, name, swatch_color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM avatar_parts);
