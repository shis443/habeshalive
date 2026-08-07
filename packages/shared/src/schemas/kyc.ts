import { z } from "zod";

export const kycIdTypeSchema = z.enum(["fayda", "kebele"]);
export type KycIdType = z.infer<typeof kycIdTypeSchema>;

export const kycStatusSchema = z.object({
  status: z.enum(["not_submitted", "pending", "approved", "rejected"]),
  idType: kycIdTypeSchema.nullable(),
  rejectionReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type KycStatus = z.infer<typeof kycStatusSchema>;

// --- Admin ---

export const kycAdminItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  idType: kycIdTypeSchema,
  status: z.enum(["pending", "approved", "rejected"]),
  rejectionReason: z.string().nullable(),
  reviewerUsername: z.string().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type KycAdminItem = z.infer<typeof kycAdminItemSchema>;

export const kycDocumentUrlSchema = z.object({
  url: z.string(),
});
export type KycDocumentUrl = z.infer<typeof kycDocumentUrlSchema>;

export const rejectKycSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectKycInput = z.infer<typeof rejectKycSchema>;
