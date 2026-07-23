import { z } from "zod";

export const streamActivityEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["gift", "subscription"]),
  username: z.string(),
  label: z.string(),
});
export type StreamActivityEvent = z.infer<typeof streamActivityEventSchema>;

export const streamActivitySchema = z.object({
  giftsCount: z.number().int().nonnegative(),
  activeSubscribers: z.number().int().nonnegative(),
  recentEvents: z.array(streamActivityEventSchema),
});
export type StreamActivity = z.infer<typeof streamActivitySchema>;
