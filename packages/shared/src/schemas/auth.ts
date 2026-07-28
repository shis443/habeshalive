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
  role: z.enum(["viewer", "creator", "moderator", "admin"]),
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
