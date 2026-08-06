import { z } from "zod";

export const followStatusSchema = z.object({
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type FollowStatus = z.infer<typeof followStatusSchema>;

// Public creator identity, independent of live status — the offline path
// of /watch/[username] has no `streams` row to derive display info from
// (getLiveStreamByUsername returns null), so this is a separate lookup
// keyed on users.username directly. isFollowing is always false for an
// anonymous request (see follows/service.ts's getCreatorProfile — same
// convention as getFollowStatus's own followerId-is-null branch).
export const creatorProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  isVerified: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  isFollowing: z.boolean(),
});
export type CreatorProfile = z.infer<typeof creatorProfileSchema>;
