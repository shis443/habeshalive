import { pool } from "./db.js";

// Mirrors db/migrations/0026_rbac_role_isolation.sql's role_permissions
// table exactly — see that migration's own adversarial-reasoning header
// for why this (an application-enforced, no-route-ever-writes-it
// reference table) is the real analog to "roles inaccessible to
// client-side updates" in this architecture, not a Postgres RLS policy
// (this app has no per-end-user Postgres connection role for RLS to key
// off of — a single shared DATABASE_URL service account handles every
// request, confirmed in common/db.ts).
export interface RolePermissions {
  can_manage_users: boolean;
  can_moderate_content: boolean;
  can_view_financials: boolean;
  can_manage_admin_config: boolean;
}

export type PermissionKey = keyof RolePermissions;

// Read-only by contract — nothing in this codebase ever writes to
// role_permissions outside the migration's own seed data (grepped, zero
// other call sites), so a live lookup here always reflects the seeded,
// reviewed capability set, never something a request could have mutated.
export async function getRolePermissions(role: string): Promise<RolePermissions | null> {
  const { rows } = await pool.query<RolePermissions>(
    `SELECT can_manage_users, can_moderate_content, can_view_financials, can_manage_admin_config
     FROM role_permissions WHERE role = $1`,
    [role]
  );
  return rows[0] ?? null;
}
