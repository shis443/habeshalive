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

export const requestOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: z.string().length(6),
  username: usernameSchema.optional(),
  displayName: z.string().min(1).max(50).optional(),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(["viewer", "creator", "moderator", "admin"]),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
