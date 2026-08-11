-- Phase 3.5 — new-content indicator on /following. NULL means "never
-- visited" (getFollowedCreators treats that as "everything counts as
-- new" — a fresh follower hasn't seen any of it yet). A single scalar
-- per user, not a per-followed-creator row: the spec's own framing is
-- "since last visit" (visiting /following itself), not per-creator
-- individual channel visits.
ALTER TABLE users ADD COLUMN following_last_seen_at TIMESTAMPTZ;
