import { z } from "zod";

// See apps/api/src/dmca/service.ts and db/migrations/0038_dmca.sql.
export const dmcaContentTypeSchema = z.enum(["vod", "clip", "stream"]);
export type DmcaContentType = z.infer<typeof dmcaContentTypeSchema>;

export const submitDmcaReportSchema = z.object({
  reporterName: z.string().min(1).max(200),
  reporterEmail: z.string().email(),
  contentType: dmcaContentTypeSchema,
  contentId: z.string().uuid(),
  contentUrl: z.string().url().optional(),
  copyrightedWorkDescription: z.string().min(1).max(5000),
  // The two statements 17 U.S.C. 512(c)(3) requires a real takedown notice
  // to contain — not optional, not defaulted, must be explicitly true.
  goodFaithStatement: z.literal(true),
  accuracyStatement: z.literal(true),
  signature: z.string().min(1).max(200),
});
export type SubmitDmcaReportInput = z.infer<typeof submitDmcaReportSchema>;

export const dmcaReportStatusSchema = z.enum(["pending", "valid", "invalid", "counter_noticed", "reinstated"]);

export const dmcaReportSchema = z.object({
  id: z.string(),
  reporterName: z.string(),
  reporterEmail: z.string(),
  contentType: dmcaContentTypeSchema,
  contentId: z.string(),
  contentUrl: z.string().nullable(),
  copyrightedWorkDescription: z.string(),
  status: dmcaReportStatusSchema,
  resolutionNotes: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type DmcaReport = z.infer<typeof dmcaReportSchema>;

export const resolveDmcaReportSchema = z.object({
  status: z.enum(["valid", "invalid", "reinstated"]),
  resolutionNotes: z.string().max(2000).optional(),
});
export type ResolveDmcaReportInput = z.infer<typeof resolveDmcaReportSchema>;

export const submitCounterNoticeSchema = z.object({
  respondentName: z.string().min(1).max(200),
  respondentAddress: z.string().min(1).max(500),
  consentToJurisdiction: z.literal(true),
  goodFaithStatement: z.literal(true),
  signature: z.string().min(1).max(200),
});
export type SubmitCounterNoticeInput = z.infer<typeof submitCounterNoticeSchema>;
