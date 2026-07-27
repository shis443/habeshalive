import { z } from "zod";

export const adminSummarySchema = z.object({
  pendingPayouts: z.number().int(),
  pendingModerationFlags: z.number().int(),
  pendingReports: z.number().int(),
  pendingAppeals: z.number().int(),
  liveStreams: z.number().int(),
  totalUsers: z.number().int(),
  totalCreators: z.number().int(),
  giftVolumeSantim: z.number().int(),
  activeSubscriptions: z.number().int(),
  mrrSantim: z.number().int(),
  boostRevenueSantim: z.number().int(),
});
export type AdminSummary = z.infer<typeof adminSummarySchema>;
