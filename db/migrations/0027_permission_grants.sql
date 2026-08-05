-- Evolves db/migrations/0026_rbac_role_isolation.sql's fixed
-- four-boolean-column role_permissions into a proper many-to-many grants
-- table. 0026 is already shared history (pushed, not yet applied to
-- production) — per this repo's forward-only migration convention (see
-- e.g. 0025 widening a CHECK constraint 0001 originally set, rather than
-- editing 0001), this evolves it with a new migration instead of
-- rewriting 0026 in place. Both apply together on the same, still-pending
-- production deploy, so role_permissions is never left in a stale,
-- half-used state in any real environment.
--
-- Why replace rather than keep both: role_permissions's fixed boolean
-- columns (can_manage_users, can_moderate_content, can_view_financials,
-- can_manage_admin_config) can't represent the more specific, namespaced
-- permissions requested for this pass (chat:moderate vs. stream:kick as
-- two distinct capabilities, not one shared can_moderate_content) without
-- adding a new column every time a new permission is needed. A
-- string-keyed grants table makes adding a future permission a data
-- change (one INSERT), not a schema migration. Keeping both tables alive
-- in parallel would let them silently drift out of sync with no
-- constraint enforcing agreement between them — worse than replacing
-- outright.
--
-- Same application-level enforcement rationale as 0026's own header:
-- this table has no write path exposed through any API route (grepped,
-- zero call sites outside migration seed data), which is the real,
-- functioning analog to "inaccessible to client-side updates" in an
-- architecture with no per-end-user Postgres session for RLS to key off.

DROP TABLE role_permissions;

CREATE TABLE role_permission_grants (
    role       VARCHAR(20) NOT NULL
                   CHECK (role IN ('viewer', 'creator', 'moderator', 'super_admin', 'finance_auditor')),
    permission VARCHAR(50) NOT NULL,
    PRIMARY KEY (role, permission)
);

INSERT INTO role_permission_grants (role, permission) VALUES
    -- Moderators: the moderation/routes.ts surface (ban/unban, reports,
    -- appeals, blocklist, moderation queue). Deliberately NOT stream:kick
    -- (force-ending a live stream directly is a separate, heavier action
    -- reserved for super_admin unless a future pass explicitly widens
    -- it) and NOT finance:audit (no reason a content moderator needs
    -- wallet/ledger visibility).
    ('moderator', 'chat:moderate'),
    -- Finance auditors: READ-ONLY financial/ledger visibility
    -- (admin/routes.ts's ledger reconciliation, platform-wallet summary,
    -- transaction lookup, revenue reports). Never granted write access —
    -- admin/routes.ts's /ledger/adjustment (creates a manual ledger
    -- entry) stays super_admin-only specifically, because "auditor"
    -- means inspection, not the power to create financial entries;
    -- granting that under the same permission name would be a real
    -- privilege escalation hiding behind an audit-sounding label.
    ('finance_auditor', 'finance:audit'),
    -- super_admin: every capability that exists today, and by
    -- convention every capability added in the future — the direct
    -- successor to the old flat 'admin' catch-all (0026's own rename).
    ('super_admin', 'chat:moderate'),
    ('super_admin', 'stream:kick'),
    ('super_admin', 'finance:audit'),
    ('super_admin', 'admin:manage_settings'),
    ('super_admin', 'admin:manage_users');
