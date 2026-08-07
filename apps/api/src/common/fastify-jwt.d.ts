import "@fastify/jwt";
import type { PermissionKey } from "./rbac.js";

// Two distinct token shapes now flow through this one plugin instance: a
// real session token ({sub, role}), and a short-lived pending-2FA token
// (auth/totp-service.ts's PendingTotpClaims, {sub, pending2fa: true}) —
// issued mid-login to a user who's proven their password/OTP but still
// owes a TOTP code, and explicitly rejected by app.ts's authenticate/
// tryAuthenticate/authenticateAndGetRole before any route handler ever
// runs (see rejectPendingTotpToken there). No route handler in this
// codebase reads req.user.role without narrowing first — confirmed via a
// repo-wide grep before widening this type — so this union doesn't ripple
// into unrelated files needing new narrowing.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string } | { sub: string; pending2fa: true };
    user: { sub: string; role: string } | { sub: string; pending2fa: true };
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
    // super_admin (or legacy 'admin', accepted permanently for
    // deploy-ordering safety — see app.ts's own comment) —
    // db/migrations/0026_rbac_role_isolation.sql's direct successor to
    // the old flat 'admin' role.
    requireAdmin: PreHandler;
    // Admits any of the given roles — e.g.
    // app.requireRole(["super_admin", "moderator"]).
    requireRole: (allowedRoles: string[]) => PreHandler;
    // Admits any role granted this capability in
    // db/migrations/0027_permission_grants.sql's role_permission_grants
    // — e.g. app.requirePermission("finance:audit").
    requirePermission: (permission: PermissionKey) => PreHandler;
    rejectIfBanned: PreHandler;
  }
}
