import type { Pool, PoolClient } from "pg";
import { pool } from "../common/db.js";

// The unified cross-cutting audit trail (see db/migrations/0013) — call
// this from every admin-triggered mutation, alongside whatever
// domain-specific table it also writes to. Accepts an optional in-flight
// transaction client so this can be the last write inside an existing
// BEGIN/COMMIT block instead of racing it as a separate connection.
export async function logAdminAction(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  options?: { reason?: string; metadata?: Record<string, unknown>; client?: Pool | PoolClient }
): Promise<void> {
  const db = options?.client ?? pool;
  await db.query(
    `INSERT INTO admin_actions (actor_id, action, target_type, target_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, targetType, targetId, options?.reason ?? null, options?.metadata ?? null]
  );
}
