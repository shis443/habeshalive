import {
  changePasswordSchema,
  changeUsernameSchema,
  confirmEmailChangeSchema,
  confirmPhoneChangeSchema,
  confirmTotpSchema,
  disableTotpSchema,
  forgotPasswordSchema,
  loginSchema,
  requestAccountDeletionSchema,
  requestEmailChangeSchema,
  requestEmailOtpSchema,
  requestOtpSchema,
  requestPhoneChangeSchema,
  resetPasswordSchema,
  revokeSessionSchema,
  socialAuthSchema,
  webBridgeExchangeSchema,
  socialProviderSchema,
  totpLoginVerifySchema,
  updatePreferencesSchema,
  updateProfileSchema,
  verifyEmailOtpSchema,
  verifyOtpSchema,
  type AuthUser,
} from "@birq/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors.js";
import {
  confirmTotp,
  disableTotp,
  getTotpStatus,
  isTotpEnabled,
  recordLoginAndNotifyIfNewDevice,
  setupTotp,
  verifyTotpForLogin,
} from "./totp-service.js";
import { createSession, listSessions, revokeSession } from "./session-service.js";
import { consumeWebBridgeCode, createWebBridgeCode } from "./web-bridge-service.js";
import {
  linkSocialAccount,
  listLinkedSocialAccounts,
  socialAuth,
  unlinkSocialAccount,
} from "./social-service.js";
import {
  cancelAccountDeletion,
  clearPendingDeletion,
  getAccountDeletionStatus,
  requestAccountDeletion,
  requestAccountDeletionOtp,
} from "./account-deletion-service.js";
import {
  changeMyPassword,
  changeUsername,
  confirmEmailChange,
  confirmPhoneChange,
  getMyAccount,
  getUserById,
  login,
  requestEmailChange,
  requestEmailOtp,
  requestOtp,
  requestPasswordReset,
  requestPhoneChange,
  resetPassword,
  updatePreferences,
  updateProfile,
  verifyEmailOtp,
  verifyOtp,
} from "./service.js";

// Keyed by phone number, not IP — the abuse this guards against (SMS-bomb
// a number, brute-force a 4-6 digit OTP) is per-number regardless of how
// many IPs an attacker rotates through. `hook: "preHandler"` (rather than
// the plugin's default `onRequest`) is required to read the parsed body —
// Fastify's body parsing completes before preHandler, not before onRequest.
function keyByPhoneNumber(req: FastifyRequest): string {
  const body = req.body as { phoneNumber?: unknown } | undefined;
  return typeof body?.phoneNumber === "string" ? `phone:${body.phoneNumber}` : req.ip;
}

// Same reasoning as keyByPhoneNumber above, keyed by email instead —
// email-bomb a mailbox / brute-force its code is per-address, not per-IP.
function keyByEmail(req: FastifyRequest): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === "string" ? `email:${body.email}` : req.ip;
}

// Same reasoning again, keyed by whichever identifier a login/password
// attempt names — this is specifically the endpoint brute-force credential
// stuffing would target, so it's kept separate from (and tighter than) the
// OTP routes' limits above.
function keyByIdentifier(req: FastifyRequest): string {
  const body = req.body as { identifier?: unknown } | undefined;
  return typeof body?.identifier === "string" ? `identifier:${body.identifier}` : req.ip;
}

// Same keying rationale as wallet/routes.ts's keyByUser — used below by
// the authenticated social-link/unlink routes.
function keyByUser(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

// Shared by every route that reaches "primary credential (password/OTP)
// verified, user identified" — /login, /verify-otp, /verify-email-otp.
// If the user has 2FA enabled, this does NOT complete the login: it
// issues a short-lived pending token instead and the caller must finish
// via POST /2fa/login-verify. If 2FA isn't enabled, behavior is
// unchanged from before this pass — a real session token, immediately.
//
// req.ip is Fastify's own, and actually resolves to the real client IP
// behind Fly's proxy (not Fly's own edge-proxy address) because app.ts's
// Fastify constructor sets trustProxy: true — used for both the
// login_events audit row and the new-device email; 'unknown' user-agent
// is a real, if rare, possibility (a bare curl/script call), not treated
// as an error.
// Shared by every path that actually mints a real session token — this
// completeLoginOrChallenge, /2fa/login-verify, and /social/:provider —
// so a sessions row (session-service.ts) always exists for a jti before
// the token that carries it goes out, matching the row app.ts's
// `authenticate` decorator will look up on every subsequent request.
async function issueSessionToken(req: FastifyRequest, reply: FastifyReply, user: AuthUser): Promise<string> {
  const sessionId = await createSession(user.id, req.ip, req.headers["user-agent"] ?? "unknown");
  return reply.jwtSign({ sub: user.id, role: user.role, jti: sessionId });
}

async function completeLoginOrChallenge(
  req: FastifyRequest,
  reply: FastifyReply,
  user: AuthUser
): Promise<void> {
  if (await isTotpEnabled(user.id)) {
    const pendingToken = await reply.jwtSign({ sub: user.id, pending2fa: true }, { expiresIn: "5m" });
    reply.send({ requiresTotp: true, pendingToken });
    return;
  }

  const token = await issueSessionToken(req, reply, user);
  await recordLoginAndNotifyIfNewDevice(user.id, req.ip, req.headers["user-agent"] ?? "unknown");
  reply.send({ token, user });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/request-otp",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByPhoneNumber,
        },
      },
    },
    async (req, reply) => {
      const input = requestOtpSchema.parse(req.body);
      await requestOtp(input.phoneNumber);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/verify-otp",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByPhoneNumber,
        },
      },
    },
    async (req, reply) => {
      const input = verifyOtpSchema.parse(req.body);
      const { user } = await verifyOtp(input);
      await clearPendingDeletion(user.id);
      await completeLoginOrChallenge(req, reply, user);
    }
  );

  app.post(
    "/request-email-otp",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByEmail,
        },
      },
    },
    async (req, reply) => {
      const input = requestEmailOtpSchema.parse(req.body);
      await requestEmailOtp(input.email);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/verify-email-otp",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByEmail,
        },
      },
    },
    async (req, reply) => {
      const input = verifyEmailOtpSchema.parse(req.body);
      const { user } = await verifyEmailOtp(input);
      await clearPendingDeletion(user.id);
      await completeLoginOrChallenge(req, reply, user);
    }
  );

  // The default, no-SMS-round-trip login path for returning users — OTP
  // above stays in service for signup and password recovery. 5/15min is
  // deliberately tighter than the OTP routes' 5/5min: this is the one
  // endpoint an attacker with a leaked/guessed password would actually
  // hit repeatedly, and a longer window matters more than burst
  // tolerance for genuine mistyped-password retries.
  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByIdentifier,
        },
      },
    },
    async (req, reply) => {
      const input = loginSchema.parse(req.body);
      const { user } = await login(input.identifier, input.password);
      await clearPendingDeletion(user.id);
      await completeLoginOrChallenge(req, reply, user);
    }
  );

  app.post(
    "/password/forgot",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByIdentifier,
        },
      },
    },
    async (req, reply) => {
      const input = forgotPasswordSchema.parse(req.body);
      await requestPasswordReset(input.identifier);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/password/reset",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: keyByIdentifier,
        },
      },
    },
    async (req, reply) => {
      const input = resetPasswordSchema.parse(req.body);
      await resetPassword(input.identifier, input.code, input.newPassword);
      reply.send({ ok: true });
    }
  );

  app.get("/me", { preHandler: app.authenticate }, async (req) => getUserById(req.user.sub));

  // --- 2FA (TOTP) ---

  app.get("/2fa/status", { preHandler: app.authenticate }, async (req) => getTotpStatus(req.user.sub));

  app.post("/2fa/setup", { preHandler: app.authenticate }, async (req) => {
    const account = await getMyAccount(req.user.sub);
    // otpauth:// label — email if the account has one (more recognizable
    // in an authenticator app's account list than a UUID), else username.
    return setupTotp(req.user.sub, account.email ?? account.username);
  });

  app.post("/2fa/confirm", { preHandler: app.authenticate }, async (req, reply) => {
    const input = confirmTotpSchema.parse(req.body);
    await confirmTotp(req.user.sub, input.code);
    reply.send({ ok: true });
  });

  app.post("/2fa/disable", { preHandler: app.authenticate }, async (req, reply) => {
    const input = disableTotpSchema.parse(req.body);
    await disableTotp(req.user.sub, input.code);
    reply.send({ ok: true });
  });

  // Deliberately NOT behind app.authenticate — the whole point is that
  // the caller doesn't have a real session token yet (that's exactly
  // what this route produces on success). Verifies pendingToken directly
  // via app.jwt.verify (the raw token string from the request body, not
  // a header — unlike every other route here, this one's "credential" is
  // a JSON field, not an Authorization header) rather than
  // req.jwtVerify(), which only ever reads from the header.
  app.post(
    "/2fa/login-verify",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: (req: FastifyRequest) => {
            const body = req.body as { pendingToken?: unknown } | undefined;
            return typeof body?.pendingToken === "string" ? `pending2fa:${body.pendingToken}` : req.ip;
          },
        },
      },
    },
    async (req, reply) => {
      const input = totpLoginVerifySchema.parse(req.body);

      let decoded: { sub: string; pending2fa?: boolean };
      try {
        decoded = app.jwt.verify<{ sub: string; pending2fa?: boolean }>(input.pendingToken);
      } catch {
        throw new AppError(401, "Invalid or expired login session — please sign in again");
      }
      if (decoded.pending2fa !== true) {
        throw new AppError(401, "Not a valid pending-2FA token");
      }

      if (!(await verifyTotpForLogin(decoded.sub, input.code))) {
        throw new AppError(401, "Invalid code");
      }

      const user = await getUserById(decoded.sub);
      const token = await issueSessionToken(req, reply, user);
      await recordLoginAndNotifyIfNewDevice(user.id, req.ip, req.headers["user-agent"] ?? "unknown");
      reply.send({ token, user });
    }
  );

  app.patch("/preferences", { preHandler: app.authenticate }, async (req) => {
    const input = updatePreferencesSchema.parse(req.body);
    return updatePreferences(req.user.sub, input.showSensitiveContent);
  });

  // --- Active device sessions (see session-service.ts) ---

  app.get("/sessions", { preHandler: app.authenticate }, async (req) => {
    const currentJti = "jti" in req.user ? req.user.jti : undefined;
    const sessions = await listSessions(req.user.sub);
    return sessions.map((session) => ({ ...session, isCurrent: session.id === currentJti }));
  });

  // Deliberately allows revoking the current session too (equivalent to a
  // remote logout) — the client is expected to discard its local token and
  // treat that the same as a normal sign-out, not to distinguish it as an
  // error case.
  app.post("/revoke-session", { preHandler: app.authenticate }, async (req, reply) => {
    const input = revokeSessionSchema.parse(req.body);
    const revoked = await revokeSession(req.user.sub, input.sessionId);
    if (!revoked) {
      throw new AppError(404, "Session not found");
    }
    reply.send({ ok: true });
  });

  // --- Mobile-to-web session bridge (see web-bridge-service.ts) ---
  //
  // Lets the mobile app open an already-authenticated web view (the /wallet
  // top-up flow, so real payment methods run through the real web checkout
  // instead of native IAP) without ever putting the session JWT in a URL.

  app.post(
    "/web-bridge-code",
    {
      preHandler: app.authenticate,
      // Generous but not unlimited — this mints a real (if short-lived and
      // single-use) credential-equivalent, same posture as the topup/payout
      // limits in wallet/routes.ts.
      config: { rateLimit: { max: 20, timeWindow: "5 minutes", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req) => {
      // Fastify's own JWT plugin decorates req.headers.authorization itself;
      // re-reading it here (rather than re-signing a fresh token) means the
      // bridged web session shares this exact token's jti/session row — if
      // this session gets revoked (POST /revoke-session, or from Active
      // Devices on another device), the bridged web session dies with it,
      // not a parallel unrevoked credential.
      const rawToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!rawToken) {
        throw new AppError(401, "unauthorized");
      }
      const account = await getMyAccount(req.user.sub);
      const code = await createWebBridgeCode(req.user.sub, account.username, rawToken);
      return { code };
    }
  );

  // Deliberately NOT behind app.authenticate, same reasoning as
  // /2fa/login-verify above — the caller doesn't have a session yet, the
  // single-use code itself (256 bits, redis-backed, 60s TTL) is the
  // credential. Called server-side by apps/web's bridge route, never
  // exposed to a browser directly.
  app.post(
    "/web-bridge-code/exchange",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "5 minutes",
          hook: "preHandler",
          skipOnError: false,
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
    },
    async (req) => {
      const input = webBridgeExchangeSchema.parse(req.body);
      const payload = await consumeWebBridgeCode(input.code);
      if (!payload) {
        throw new AppError(401, "Invalid or expired code");
      }
      return payload;
    }
  );

  // --- E.1: account identity ---

  app.get("/account", { preHandler: app.authenticate }, async (req) => getMyAccount(req.user.sub));

  app.patch("/account/profile", { preHandler: app.authenticate }, async (req) => {
    const input = updateProfileSchema.parse(req.body);
    return updateProfile(req.user.sub, input);
  });

  app.patch("/account/username", { preHandler: app.authenticate }, async (req) => {
    const input = changeUsernameSchema.parse(req.body);
    return changeUsername(req.user.sub, input.username);
  });

  app.post("/account/phone/request", { preHandler: app.authenticate }, async (req, reply) => {
    const input = requestPhoneChangeSchema.parse(req.body);
    await requestPhoneChange(req.user.sub, input.phoneNumber);
    reply.send({ ok: true });
  });

  app.post("/account/phone/confirm", { preHandler: app.authenticate }, async (req) => {
    const input = confirmPhoneChangeSchema.parse(req.body);
    return confirmPhoneChange(req.user.sub, input.code);
  });

  app.post("/account/email/request", { preHandler: app.authenticate }, async (req, reply) => {
    const input = requestEmailChangeSchema.parse(req.body);
    await requestEmailChange(req.user.sub, input.email);
    reply.send({ ok: true });
  });

  app.post("/account/email/confirm", { preHandler: app.authenticate }, async (req) => {
    const input = confirmEmailChangeSchema.parse(req.body);
    return confirmEmailChange(req.user.sub, input.code);
  });

  app.post("/account/password", { preHandler: app.authenticate }, async (req, reply) => {
    const input = changePasswordSchema.parse(req.body);
    await changeMyPassword(req.user.sub, input);
    reply.send({ ok: true });
  });

  // --- E.8: account deletion ---

  app.get("/account/deletion", { preHandler: app.authenticate }, async (req) =>
    getAccountDeletionStatus(req.user.sub)
  );

  app.post("/account/deletion/request-otp", { preHandler: app.authenticate }, async (req, reply) => {
    await requestAccountDeletionOtp(req.user.sub);
    reply.send({ ok: true });
  });

  app.post("/account/deletion", { preHandler: app.authenticate }, async (req) => {
    const input = requestAccountDeletionSchema.parse(req.body);
    return requestAccountDeletion(req.user.sub, input);
  });

  app.delete("/account/deletion", { preHandler: app.authenticate }, async (req, reply) => {
    await cancelAccountDeletion(req.user.sub);
    reply.send({ ok: true });
  });

  // --- E.3: social auth ---
  // Relied on the global 2000/min-per-IP default only (docs/SECURITY.md's
  // known-gaps list) — this is the credential-stuffing-shaped endpoint of
  // this group (an attacker submitting a flood of forged/stolen id
  // tokens), same risk class /login already gets a strict limit for. No
  // phone/email/identifier field exists pre-verification here, so this
  // keys by IP (the plugin's default keyGenerator) rather than a custom one.

  app.post<{ Params: { provider: string } }>(
    "/social/:provider",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes", hook: "preHandler", skipOnError: false } } },
    async (req, reply) => {
      const provider = socialProviderSchema.parse(req.params.provider);
      const input = socialAuthSchema.parse(req.body);
      const { user } = await socialAuth(provider, input.idToken, input.fullName);
      await clearPendingDeletion(user.id);
      const token = await issueSessionToken(req, reply, user);
      reply.send({ token, user });
    }
  );

  app.get("/social", { preHandler: app.authenticate }, async (req) => listLinkedSocialAccounts(req.user.sub));

  // Linking/unlinking are authenticated and lower-volume than the login
  // route above, but still real account-security actions — user-keyed,
  // matching wallet/routes.ts's keyByUser pattern.
  app.post<{ Params: { provider: string } }>(
    "/social/:provider/link",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req, reply) => {
      const provider = socialProviderSchema.parse(req.params.provider);
      const input = socialAuthSchema.parse(req.body);
      await linkSocialAccount(req.user.sub, provider, input.idToken);
      reply.send({ ok: true });
    }
  );

  app.delete<{ Params: { provider: string } }>(
    "/social/:provider",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: keyByUser } },
    },
    async (req, reply) => {
      const provider = socialProviderSchema.parse(req.params.provider);
      await unlinkSocialAccount(req.user.sub, provider);
      reply.send({ ok: true });
    }
  );
};
