import { z } from "zod";

export const adminSummarySchema = z.object({
  pendingPayouts: z.number().int(),
  pendingModerationFlags: z.number().int(),
  pendingReports: z.number().int(),
  pendingAppeals: z.number().int(),
  liveStreams: z.number().int(),
  totalUsers: z.number().int(),
});
export type AdminSummary = z.infer<typeof adminSummarySchema>;
