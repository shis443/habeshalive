import type { Pool, PoolClient } from "pg";
import { pool } from "../common/db.js";
import { getAdminRequestContext } from "../common/request-context.js";

// The unified cross-cutting audit trail (see db/migrations/0013) — call
// this from every admin-triggered mutation, alongside whatever
// domain-specific table it also writes to. Accepts an optional in-flight
// transaction client so this can be the last write inside an existing
// BEGIN/COMMIT block instead of racing it as a separate connection.
//
// actor_ip/actor_session are read from the ambient request context
// (common/request-context.ts, an AsyncLocalStorage populated by app.ts's
// onRequest hook and its auth decorators) rather than taken as explicit
// parameters here — the ~40 real call sites for this function are mostly
// several layers removed from the Fastify request object itself (a
// route handler calls a service function, which calls this), and
// threading req.ip/req.user.jti through every one of those call chains
// would be a much larger, unrelated refactor. A call made outside a real
// request (a background job, a test) simply gets null for both, same as
// a request whose auth never resolved — never a thrown error.
//
// before/after are optional and explicit at each call site, on purpose:
// unlike actor_ip/actor_session, "what changed" is domain knowledge this
// function cannot infer, and forcing every call site to state its own
// answer (even literally { before: null, after: null } for an action with
// no natural snapshot) is what keeps this honest rather than defaulted
// away.
export async function logAdminAction(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  options?: {
    reason?: string;
    metadata?: Record<string, unknown>;
    before?: unknown;
    after?: unknown;
    client?: Pool | PoolClient;
  }
): Promise<void> {
  const db = options?.client ?? pool;
  const { actorIp, actorSession } = getAdminRequestContext();
  await db.query(
    `INSERT INTO admin_actions
       (actor_id, action, target_type, target_id, reason, metadata,
        actor_ip, actor_session, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actorId,
      action,
      targetType,
      targetId,
      options?.reason ?? null,
      options?.metadata ?? null,
      actorIp,
      actorSession,
      options?.before === undefined ? null : JSON.stringify(options.before),
      options?.after === undefined ? null : JSON.stringify(options.after),
    ]
  );
}
