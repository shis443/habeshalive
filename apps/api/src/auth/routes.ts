import {
  forgotPasswordSchema,
  loginSchema,
  requestEmailOtpSchema,
  requestOtpSchema,
  resetPasswordSchema,
  updatePreferencesSchema,
  verifyEmailOtpSchema,
  verifyOtpSchema,
} from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  getUserById,
  login,
  requestEmailOtp,
  requestOtp,
  requestPasswordReset,
  resetPassword,
  updatePreferences,
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
};
