import { z } from "zod";

export const reportTargetTypeSchema = z.enum(["stream", "user", "gift_message"]);
export const reportReasonSchema = z.enum(["harassment", "hate_speech", "spam", "nudity", "copyright", "other"]);

export const submitReportSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: reportReasonSchema,
  details: z.string().max(500).optional(),
});
export type SubmitReportInput = z.infer<typeof submitReportSchema>;

export const reportSchema = z.object({
  id: z.string().uuid(),
  reporterId: z.string().uuid(),
  reporterUsername: z.string(),
  targetType: reportTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  status: z.enum(["pending", "actioned", "dismissed"]),
  createdAt: z.string(),
});
export type Report = z.infer<typeof reportSchema>;

export const resolveReportSchema = z.object({
  status: z.enum(["actioned", "dismissed"]),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

// .min(1), not .optional() — a ban is exactly the kind of action a
// moderator must be able to justify later, and enforcing that at the
// schema means the route rejects an empty reason with 400 before it ever
// reaches banUser(), rather than depending on the admin UI to remember to
// require one. Ground rule: every admin mutation writes a non-empty
// reason, enforced server-side.
export const banUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1).max(300),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

// Previously had no reason field at all — unbanUser()'s own signature
// already accepted one (moderation/actions-service.ts), but nothing at
// the route/schema layer ever collected or required it, so every real
// unban wrote reason = NULL to both moderation_actions and admin_actions.
export const unbanUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1).max(300),
});
export type UnbanUserInput = z.infer<typeof unbanUserSchema>;

export const submitAppealSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type SubmitAppealInput = z.infer<typeof submitAppealSchema>;

export const appealSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "denied"]),
  createdAt: z.string(),
});
export type Appeal = z.infer<typeof appealSchema>;

export const resolveAppealSchema = z.object({
  action: z.enum(["approve", "deny"]),
});
export type ResolveAppealInput = z.infer<typeof resolveAppealSchema>;
