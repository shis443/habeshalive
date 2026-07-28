-- Content labeling: creators can mark a stream sensitive/mature at go-live
-- time; viewers opt in via an account-level preference (default off, so
-- logged-out visitors and anyone who hasn't opted in never see labeled
-- streams at all — a safe default, not an oversight).
ALTER TABLE streams ADD COLUMN is_sensitive BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN show_sensitive_content BOOLEAN NOT NULL DEFAULT FALSE;
