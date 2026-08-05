import "@fastify/jwt";
import type { PermissionKey } from "./rbac.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
}

type PreHandler = (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyInstance {
    authenticate: PreHandler;
    // Attempts jwtVerify but never rejects the request — req.user is only
    // populated when a valid token was actually sent, so handlers using
    // this must treat req.user as possibly absent despite the type above.
    tryAuthenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
    // super_admin only (db/migrations/0026_rbac_role_isolation.sql) — the
    // direct successor to the old flat 'admin' role.
    requireAdmin: PreHandler;
    // Admits any of the given roles — e.g.
    // app.requireRole(["super_admin", "moderator"]).
    requireRole: (allowedRoles: string[]) => PreHandler;
    // Admits any role whose role_permissions row has this capability set
    // — e.g. app.requirePermission("can_view_financials").
    requirePermission: (permission: PermissionKey) => PreHandler;
    rejectIfBanned: PreHandler;
  }
}
