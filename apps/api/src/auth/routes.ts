import {
  changePasswordSchema,
  changeUsernameSchema,
  confirmEmailChangeSchema,
  confirmPhoneChangeSchema,
  forgotPasswordSchema,
  loginSchema,
  requestAccountDeletionSchema,
  requestEmailChangeSchema,
  requestEmailOtpSchema,
  requestOtpSchema,
  requestPhoneChangeSchema,
  resetPasswordSchema,
  socialAuthSchema,
  socialProviderSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  verifyEmailOtpSchema,
  verifyOtpSchema,
} from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
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
      const token = await reply.jwtSign({ sub: user.id, role: user.role });
      reply.send({ token, user });
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
      const token = await reply.jwtSign({ sub: user.id, role: user.role });
      reply.send({ token, user });
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
      const token = await reply.jwtSign({ sub: user.id, role: user.role });
      reply.send({ token, user });
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

  app.patch("/preferences", { preHandler: app.authenticate }, async (req) => {
    const input = updatePreferencesSchema.parse(req.body);
    return updatePreferences(req.user.sub, input.showSensitiveContent);
  });

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

  app.post<{ Params: { provider: string } }>("/social/:provider", async (req, reply) => {
    const provider = socialProviderSchema.parse(req.params.provider);
    const input = socialAuthSchema.parse(req.body);
    const { user } = await socialAuth(provider, input.idToken, input.fullName);
    await clearPendingDeletion(user.id);
    const token = await reply.jwtSign({ sub: user.id, role: user.role });
    reply.send({ token, user });
  });

  app.get("/social", { preHandler: app.authenticate }, async (req) => listLinkedSocialAccounts(req.user.sub));

  app.post<{ Params: { provider: string } }>(
    "/social/:provider/link",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const provider = socialProviderSchema.parse(req.params.provider);
      const input = socialAuthSchema.parse(req.body);
      await linkSocialAccount(req.user.sub, provider, input.idToken);
      reply.send({ ok: true });
    }
  );

  app.delete<{ Params: { provider: string } }>(
    "/social/:provider",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const provider = socialProviderSchema.parse(req.params.provider);
      await unlinkSocialAccount(req.user.sub, provider);
      reply.send({ ok: true });
    }
  );
};
