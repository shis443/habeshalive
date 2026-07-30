import { z } from "zod";

export const submitCreatorApplicationSchema = z.object({
  applicationText: z.string().min(20).max(2000),
  socialLinks: z.string().max(1000).optional(),
});
export type SubmitCreatorApplicationInput = z.infer<typeof submitCreatorApplicationSchema>;

export const myCreatorApplicationSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
  applicationText: z.string(),
  socialLinks: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type MyCreatorApplication = z.infer<typeof myCreatorApplicationSchema>;

// --- Admin ---

export const creatorApplicationAdminItemSchema = z.object({
  id: z.string().uuid(),
  applicantId: z.string().uuid(),
  applicantUsername: z.string(),
  applicationText: z.string(),
  socialLinks: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewerUsername: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type CreatorApplicationAdminItem = z.infer<typeof creatorApplicationAdminItemSchema>;

export const rejectCreatorApplicationSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type RejectCreatorApplicationInput = z.infer<typeof rejectCreatorApplicationSchema>;

export const creatorApplicationCapStatusSchema = z.object({
  approvedCount: z.number().int(),
  cap: z.number().int(),
});
export type CreatorApplicationCapStatus = z.infer<typeof creatorApplicationCapStatusSchema>;
