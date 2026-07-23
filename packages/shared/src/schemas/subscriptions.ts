import { z } from "zod";

export const subscriptionTierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceSantim: z.number().int().positive(),
});
export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

export const subscribeInputSchema = z.object({
  creatorId: z.string().uuid(),
  tierId: z.string().uuid(),
});
export type SubscribeInput = z.infer<typeof subscribeInputSchema>;

export const subscribeResponseSchema = z.object({
  id: z.string().uuid(),
  tierName: z.string(),
  expiresAt: z.string(),
});
export type SubscribeResponse = z.infer<typeof subscribeResponseSchema>;
