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

export const banUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(300).optional(),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

export const unbanUserSchema = z.object({
  userId: z.string().uuid(),
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
