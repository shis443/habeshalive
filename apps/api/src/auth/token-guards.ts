// Two non-session token shapes are signed with the same secret as a real
// session token, so a plain signature-verify accepts either just fine —
// this predicate is what actually stops them from also working as one: a
// pending-2FA token (totp-service.ts's PendingTotpClaims — issued mid-login
// to a user who's proven their password/OTP but still owes a TOTP code) and
// a PPV access token (streams/ppv-service.ts's PpvAccessClaims, {sub,
// streamId, ppvAccess: true, jti} — issued after a pay-per-view purchase).
//
// Shared by app.ts's `authenticate`/`tryAuthenticate` decorators (which
// check req.user after req.jwtVerify()) and remote-control/relay.ts (which
// verifies a query-string token directly via app.jwt.verify(), never
// populating req.user at all) — same security-critical condition, checked
// once rather than risking the two call sites drifting apart.
export function isNonSessionToken(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && ("pending2fa" in payload || "ppvAccess" in payload);
}
