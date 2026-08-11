-- Phase 3.4 — category following, a genuinely different discovery path
-- from follows (0001_init.sql): "tell me when anyone streams Traditional
-- music" rather than "tell me when this person streams". Separate table,
-- not a nullable creator_id on follows, since a row here was never about
-- a specific user and forcing the existing table to express "sometimes
-- this FK is empty" would be worse than a second small table.
CREATE TABLE category_follows (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, category)
);
CREATE INDEX idx_category_follows_category ON category_follows (category);
