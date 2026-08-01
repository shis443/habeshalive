-- C.6: stream tags. Fully greenfield — nothing existed to extend.
CREATE TABLE stream_tags (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(30) UNIQUE NOT NULL,
    is_banned   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- text_pattern_ops so ILIKE 'prefix%' autocomplete lookups can use the
-- index (the default btree opclass can't for pattern-prefix matches).
CREATE INDEX idx_stream_tags_name_prefix ON stream_tags (name text_pattern_ops);

CREATE TABLE stream_tag_links (
    stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES stream_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (stream_id, tag_id)
);
CREATE INDEX idx_stream_tag_links_tag ON stream_tag_links (tag_id);
