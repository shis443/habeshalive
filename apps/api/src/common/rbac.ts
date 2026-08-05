import { pool } from "./db.js";

// Mirrors db/migrations/0027_permission_grants.sql's role_permission_grants
// table exactly — see that migration's own header for why this (an
// application-enforced, no-route-ever-writes-it reference table) is the
// real analog to "roles inaccessible to client-side updates" in this
// architecture, not a Postgres RLS policy (this app has no per-end-user
// Postgres connection role for RLS to key off of — a single shared
// DATABASE_URL service account handles every request, confirmed in
// common/db.ts).
//
// A literal union, not a bare `string` — every real call site names a
// permission at compile time (e.g. app.requirePermission("chat:moderate")
// in a route file), so a typo here should be a type error, not a 403 no
// one notices until someone reports being locked out of a route they
// should have access to.
export type PermissionKey =
  | "chat:moderate"
  | "stream:kick"
  | "finance:audit"
  | "admin:manage_settings"
  | "admin:manage_users";

// Read-only by contract — nothing in this codebase ever writes to
// role_permission_grants outside the migration's own seed data (grepped,
// zero other call sites), so a live lookup here always reflects the
// seeded, reviewed grant set, never something a request could have
// mutated.
//
// Deliberately fails closed (deny) rather than throwing if the table
// itself doesn't exist yet (Postgres error 42P01, "undefined_table").
// This app's zero-lockout deploy strategy deploys this code *before*
// applying db/migrations/0027_permission_grants.sql (the migration that
// creates this table) — see app.ts's requireAdmin/requireRole comment
// for why code-before-migration is the safer order for the legacy-role
// dual-compat check, which this same deploy also ships. The tradeoff:
// for the narrow set of routes retrofitted to requirePermission in this
// same change, that ordering means a brief window where this table
// doesn't exist yet. Failing closed turns that window into "these
// specific actions return 403 for a few minutes" instead of "500,
// unhandled error" — recoverable and non-alarming, not a real lockout of
// admin/moderator dashboard access as a whole (which never depends on
// this table — see requireAdmin/requireRole).
export async function roleHasPermission(role: string, permission: PermissionKey): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM role_permission_grants WHERE role = $1 AND permission = $2) AS exists`,
      [role, permission]
    );
    return rows[0]?.exists ?? false;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      console.error(
        "[rbac] role_permission_grants does not exist yet (migration 0027 not applied) — denying by default"
      );
      return false;
    }
    throw err;
  }
}
