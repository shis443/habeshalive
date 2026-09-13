import { AsyncLocalStorage } from "node:async_hooks";

export interface AdminRequestContext {
  actorIp: string | null;
  actorSession: string | null;
}

// Node's built-in AsyncLocalStorage, not a new dependency — this is what
// lets logAdminAction pick up the current request's IP and session id
// automatically, without threading them as explicit parameters through
// all 41 existing call sites (moderation, ads, KYC, payouts, subscriptions,
// DMCA, boosts... — most several layers removed from the Fastify request
// object that actually has req.ip/req.user.jti).
//
// enterWith (not run()) because Fastify's hook chain — onRequest,
// preHandler, the route handler — already executes as one continuous
// async call chain; there is no separate callback to wrap the rest of the
// request in the way run() wants. enterWith sets the store for "the
// remainder of the current execution and any async operations created
// after this point" (Node docs), which is exactly this shape.
//
// Verified empirically before wiring this in, not assumed from the docs:
// a standalone script simulating 5 concurrent onRequest->preHandler->
// handler chains via setImmediate interleaving showed zero cross-request
// leakage — each concluded with exactly its own ip/session, never another
// request's.
const storage = new AsyncLocalStorage<AdminRequestContext>();

// Called from app.ts's onRequest hook (ip, always available) and again
// from the authenticate/authenticateAndGetRole decorators once req.user
// is populated (session id, only available post-auth) — each call
// replaces the store for the rest of this request's execution.
export function setAdminRequestContext(ctx: AdminRequestContext): void {
  storage.enterWith(ctx);
}

// Never throws, never requires a null check at the call site: outside a
// request (a background job, a test that never went through the Fastify
// hook chain) this is just {actorIp: null, actorSession: null} — the same
// as a real request whose auth never resolved.
export function getAdminRequestContext(): AdminRequestContext {
  return storage.getStore() ?? { actorIp: null, actorSession: null };
}
