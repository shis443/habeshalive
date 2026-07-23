import { z } from "zod";

export const followStatusSchema = z.object({
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type FollowStatus = z.infer<typeof followStatusSchema>;
