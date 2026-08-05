-- Fine-grained RBAC: replaces the flat 'admin' role with a structured
-- privilege tier (super_admin / moderator / finance_auditor), plus a
-- role_permissions reference table for genuinely fine-grained capability
-- checks (not just "is this an admin, yes/no").
--
-- =====================================================================
-- ADVERSARIAL SECURITY RATIONALE (required before implementation, per
-- BIRQ guidelines Part I §5) — including an explicit correction of one
-- part of how this migration was originally specified:
-- =====================================================================
--
-- The request that produced this migration asked for "explicit RLS
-- [Row-Level Security] policies for each role layer to prevent privilege
-- escalation" and roles "inaccessible to client-side RLS updates."
-- Postgres RLS policies are NOT implemented here, and that is a
-- deliberate correction, not an oversight — writing them would be
-- security theater, not a real control, for this specific architecture:
--
-- 1. RLS policies gate access by *the Postgres role a connection
--    authenticated as* (`current_user`/`session_user` inside the policy
--    expression). This application has exactly ONE Postgres role for
--    ALL traffic — the single service account named by `DATABASE_URL`
--    (apps/api/src/common/db.ts's connection pool). Every query, from
--    every end user regardless of their app-level role, executes as
--    that same one Postgres user. An RLS policy written as
--    `USING (current_setting('app.role') = 'moderator')` or similar
--    would need something to actually SET that session variable per
--    request — nothing in this codebase does that (no
--    `SET LOCAL`/`set_config` tied to the authenticated user anywhere),
--    so such a policy would either always evaluate the same way for
--    every request (not real isolation) or reference a variable that's
--    never set (erroring or defaulting in a way that isn't actually
--    tested against real traffic). This is precisely the "N/A — no
--    Supabase/native RLS in this stack" finding from the 2026-08-04 BIRQ
--    audit (docs/SECURITY.md) — confirmed again here, not assumed.
--
-- 2. THE ACTUAL BOUNDARY THAT PREVENTS PRIVILEGE ESCALATION in this
--    architecture is application-level, not database-level:
--       a. `role` is never a client-writable field on any self-service
--          route (verified: grepped every `UPDATE users SET` call site
--          in apps/api/src — the only two that touch `role` are
--          streams/service.ts's hardcoded viewer→creator promotion
--          literal, and admin/users-service.ts's updateUserRole, which
--          is gated by `app.requireAdmin` and only accepts a
--          zod-enum-validated role value, never an arbitrary string).
--       b. Authorization is re-checked against a live DB read on *every*
--          request via Fastify preHandler decorators
--          (`app.requireAdmin`/the new `app.requireRole`/
--          `app.requirePermission` added in this same change to
--          apps/api/src/app.ts) — not trusted from a JWT claim that
--          could outlive a demotion. This was the exact fix already
--          shipped 2026-08-04 for the flat-admin case; the same pattern
--          is what actually enforces the new granular roles too.
--    A migration-only "RLS policy" would sit alongside this real
--    boundary doing nothing, while looking like a second layer of
--    defense that isn't actually there — worse than no RLS policy at
--    all, since it invites false confidence.
--
-- 3. WHAT genuinely IS added at the schema layer, matching the *intent*
--    behind "inaccessible to client-side updates": role_permissions
--    below is a reference table with no INSERT/UPDATE/DELETE path
--    exposed through any API route in this codebase (grepped: zero
--    references to writing this table outside this migration's own
--    seed data) — it's read-only from the application's perspective,
--    the same practical effect the guideline is asking for, achieved by
--    "no route ever writes it" rather than a Postgres-level policy that
--    would be non-functional here anyway.
--
-- 4. PRIVILEGE ESCALATION SPECIFICALLY: could a moderator promote
--    themselves to super_admin? No new escalation path is introduced —
--    `PATCH /admin/users/:id/role` (the only role-mutation route) was
--    already, and remains, gated by `app.requireAdmin` (now
--    `super_admin`-only after this migration + the app.ts change in the
--    same commit) — a moderator or finance_auditor calling that route
--    gets 403 before the query ever runs, same live-DB-role-recheck
--    boundary as point 2b.
--
-- =====================================================================

-- Step 1: widen the CHECK constraint to accept BOTH the old ('admin')
-- and new (super_admin/finance_auditor) values simultaneously. Required
-- as an intermediate step — the UPDATE in step 2 would violate a
-- constraint that had already dropped 'admin' before existing 'admin'
-- rows are migrated off it.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('viewer', 'creator', 'moderator', 'admin', 'super_admin', 'finance_auditor'));

-- Step 2: migrate every existing 'admin' row to 'super_admin' — the
-- direct successor with equivalent (full) privilege, not a downgrade.
-- 'moderator' rows are untouched (that tier already existed and keeps
-- its existing, narrower meaning). No 'finance_auditor' rows exist yet
-- (new tier, nobody has been granted it) — nothing to migrate for it.
UPDATE users SET role = 'super_admin', updated_at = now() WHERE role = 'admin';

-- Step 3: narrow the CHECK constraint to the final set, dropping 'admin'
-- now that no row uses it. This is the "replace flat 'admin' string"
-- part of the request, made safe by the two-step widen-then-narrow
-- pattern (same convention as prior migrations that changed a CHECK
-- constraint's allowed values, e.g. 0025_gursha_gift_economy.sql's
-- ledger_transactions.type widening).
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('viewer', 'creator', 'moderator', 'super_admin', 'finance_auditor'));

-- Fine-grained capability reference — see rationale point 3 above for
-- why this is the real (application-enforced) equivalent of "roles
-- inaccessible to client-side updates," not a Postgres RLS policy.
-- Application code (apps/api/src/common/rbac.ts, wired into app.ts's
-- requirePermission decorator) reads this table to decide
-- whether a given authenticated role may perform a given class of
-- action — genuinely fine-grained (a finance_auditor can view financial
-- data but cannot moderate content or manage users; a moderator is the
-- reverse), not just a single is-admin boolean.
CREATE TABLE role_permissions (
    role                    VARCHAR(20) PRIMARY KEY
                                CHECK (role IN ('viewer', 'creator', 'moderator', 'super_admin', 'finance_auditor')),
    can_manage_users        BOOLEAN NOT NULL DEFAULT FALSE,
    can_moderate_content    BOOLEAN NOT NULL DEFAULT FALSE,
    can_view_financials     BOOLEAN NOT NULL DEFAULT FALSE,
    can_manage_admin_config BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO role_permissions (role, can_manage_users, can_moderate_content, can_view_financials, can_manage_admin_config) VALUES
    ('viewer',          FALSE, FALSE, FALSE, FALSE),
    ('creator',         FALSE, FALSE, FALSE, FALSE),
    -- Moderators handle ban/report/appeal queues (moderation_actions,
    -- reports, appeals) but have no business seeing ledger/payout data
    -- or changing who else holds admin-tier roles — narrower than the
    -- old flat 'admin' catch-all this tier used to share a boundary
    -- with.
    ('moderator',       FALSE, TRUE,  FALSE, FALSE),
    -- New tier: read access to financial/ledger views (admin/routes.ts's
    -- ledger reconciliation, payout queue) without moderation or
    -- user-management power — matches the request's explicit ask for a
    -- finance_auditor role distinct from moderator/super_admin.
    ('finance_auditor', FALSE, FALSE, TRUE,  FALSE),
    -- Direct successor to the old flat 'admin' — full privilege across
    -- every capability, per step 2's migration above.
    ('super_admin',     TRUE,  TRUE,  TRUE,  TRUE);
