import "@fastify/jwt";
import type { PermissionKey } from "./rbac.js";

// Three distinct token shapes now flow through this one plugin instance:
// a real session token ({sub, role, jti?} — jti links back to a row in
// auth/session-service.ts's sessions table, checked by app.ts's
// `authenticate` decorator on every request; optional because tokens
// issued before that table existed carry none and are grandfathered
// through unchecked), a short-lived pending-2FA token
// (auth/totp-service.ts's PendingTotpClaims, {sub, pending2fa: true}) —
// issued mid-login to a user who's proven their password/OTP but still
// owes a TOTP code — and a PPV access token (streams/ppv-service.ts's
// PpvAccessClaims, {sub, streamId, ppvAccess: true, jti}) issued after a
// successful pay-per-view purchase, verified directly via app.jwt.verify
// in streams/routes.ts rather than through app.authenticate (its sub is
// the buyer, not necessarily "the logged-in session," matters for the
// embed route — see that file's comment). Both non-session shapes are
// explicitly rejected by app.ts's authenticate/tryAuthenticate/
// authenticateAndGetRole before any route handler ever runs (see
// rejectNonSessionToken there). No route handler in this codebase reads
// req.user.role without narrowing first — confirmed via a repo-wide grep
// before widening this type — so this union doesn't ripple into
// unrelated files needing new narrowing.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload:
      | { sub: string; role: string; jti?: string }
      | { sub: string; pending2fa: true }
      | { sub: string; streamId: string; ppvAccess: true; jti: string };
    user:
      | { sub: string; role: string; jti?: string }
      | { sub: string; pending2fa: true }
      | { sub: string; streamId: string; ppvAccess: true; jti: string };
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
