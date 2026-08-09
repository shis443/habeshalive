import { z } from "zod";

// Ethiopian mobile numbers in E.164 form, e.g. +251911234567 or +251711234567.
export const phoneNumberSchema = z
  .string()
  .regex(/^\+251[79]\d{8}$/, "Enter a valid Ethiopian phone number, e.g. +251911234567");

export const usernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores");

// Same min length applied to both new-account creation and password
// reset — no upper bound tied to a specific hash algorithm's input limit
// (unlike bcrypt's 72-byte cap) since this is scrypt, see password.ts.
export const passwordSchema = z.string().min(8).max(200);

export const requestOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: z.string().length(6),
  username: usernameSchema.optional(),
  displayName: z.string().min(1).max(50).optional(),
  // Optional here for the same reason username/displayName are: only
  // actually required when this verification is creating a new account,
  // which the service layer enforces together with the other two (a
  // returning user's login doesn't touch this endpoint at all anymore —
  // see loginSchema below).
  password: passwordSchema.optional(),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const requestEmailOtpSchema = z.object({
  email: z.string().email(),
});
export type RequestEmailOtpInput = z.infer<typeof requestEmailOtpSchema>;

export const verifyEmailOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  username: usernameSchema.optional(),
  displayName: z.string().min(1).max(50).optional(),
  password: passwordSchema.optional(),
});
export type VerifyEmailOtpInput = z.infer<typeof verifyEmailOtpSchema>;

// identifier is deliberately a loose string here, not phoneNumberSchema-or-
// email union — the service layer decides phone vs email by shape (see
// auth/service.ts's identifierKind) and looks the user up accordingly; a
// wrong-shaped identifier just fails to match any account, same as a wrong
// password would, rather than surfacing a schema-level "invalid phone/email"
// error that would leak which check a login attempt failed at.
export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(3),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  identifier: z.string().min(3),
  code: z.string().length(6),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" stays permanently — see admin.ts's identical schema for the
  // full reasoning (getCurrentUser() runtime-validates against this via
  // .parse(), so it must accept every value the DB can legitimately hold
  // during the deploy window, not just the post-migration set).
  role: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
  showSensitiveContent: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const updatePreferencesSchema = z.object({
  showSensitiveContent: z.boolean(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// --- 2FA (TOTP, RFC 6238 — apps/api/src/auth/totp.ts) ---

// Login now returns one of two shapes: a normal AuthResponse (2FA not
// enabled — unchanged, existing behavior), or this challenge (2FA
// enabled — the caller must POST pendingToken+code to /2fa/login-verify
// to get a real AuthResponse). pendingToken is a short-lived, purpose-
// restricted JWT — see app.ts's rejectPendingTotpToken for why it can
// never be used in place of a real session token.
export const totpChallengeSchema = z.object({
  requiresTotp: z.literal(true),
  pendingToken: z.string(),
});
export type TotpChallenge = z.infer<typeof totpChallengeSchema>;

export const loginResultSchema = z.union([authResponseSchema, totpChallengeSchema]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export const totpStatusSchema = z.object({
  enabled: z.boolean(),
});
export type TotpStatus = z.infer<typeof totpStatusSchema>;

export const totpSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

const totpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

export const confirmTotpSchema = z.object({
  code: totpCodeSchema,
});
export type ConfirmTotpInput = z.infer<typeof confirmTotpSchema>;

export const disableTotpSchema = z.object({
  code: totpCodeSchema,
});
export type DisableTotpInput = z.infer<typeof disableTotpSchema>;

export const totpLoginVerifySchema = z.object({
  pendingToken: z.string(),
  code: totpCodeSchema,
});
export type TotpLoginVerifyInput = z.infer<typeof totpLoginVerifySchema>;

// --- E.1: account identity ---

export const myAccountSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  email: z.string().nullable(),
  pendingPhoneNumber: z.string().nullable(),
  pendingEmail: z.string().nullable(),
  hasPassword: z.boolean(),
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" stays permanently — see admin.ts's identical schema for the
  // full reasoning (getCurrentUser() runtime-validates against this via
  // .parse(), so it must accept every value the DB can legitimately hold
  // during the deploy window, not just the post-migration set).
  role: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
  isVerified: z.boolean(),
  deletionRequestedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MyAccount = z.infer<typeof myAccountSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(300).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changeUsernameSchema = z.object({
  username: usernameSchema,
});
export type ChangeUsernameInput = z.infer<typeof changeUsernameSchema>;

export const requestPhoneChangeSchema = z.object({
  phoneNumber: phoneNumberSchema,
});
export type RequestPhoneChangeInput = z.infer<typeof requestPhoneChangeSchema>;

export const confirmPhoneChangeSchema = z.object({
  code: z.string().length(6),
});
export type ConfirmPhoneChangeInput = z.infer<typeof confirmPhoneChangeSchema>;

export const requestEmailChangeSchema = z.object({
  email: z.string().email(),
});
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  code: z.string().length(6),
});
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

// currentPassword is only actually required when the account already has
// one — enforced in the service layer (a user who signed up via OTP and
// never set a password can't supply a "current" one that doesn't exist).
export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// --- E.8: account deletion ---

export const requestAccountDeletionSchema = z.object({
  password: z.string().optional(),
  code: z.string().length(6).optional(),
});
export type RequestAccountDeletionInput = z.infer<typeof requestAccountDeletionSchema>;

export const accountDeletionStatusSchema = z.object({
  deletionRequestedAt: z.string().nullable(),
  gracePeriodEndsAt: z.string().nullable(),
});
export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;

// --- Active device sessions (see apps/api/src/auth/session-service.ts) ---

export const sessionSchema = z.object({
  id: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  // Set by the API by comparing each row's id to the calling request's own
  // jti — not a stored column — so the client can label "this device"
  // distinctly from other sessions in the same list.
  isCurrent: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});
export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;
