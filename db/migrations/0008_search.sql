-- Full-text search over streams (title + category) and creators
-- (username + display_name + bio). Uses Postgres's 'simple' text search
-- config, not 'english' — 'english' applies English-specific stemming and
-- a stopword list that would silently mishandle Amharic (Ge'ez script)
-- text in stream titles/bios, which is a real, expected case for this
-- platform; 'simple' just lowercases and tokenizes without that.
--
-- Generated STORED columns (Postgres 12+, not a trigger) so the tsvector
-- stays in sync with the source columns automatically.
ALTER TABLE streams ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category, ''))) STORED;
CREATE INDEX idx_streams_search ON streams USING GIN (search_vector);

ALTER TABLE users ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(bio, ''))
    ) STORED;
CREATE INDEX idx_users_search ON users USING GIN (search_vector);
