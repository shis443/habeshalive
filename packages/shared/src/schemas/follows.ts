import { z } from "zod";
import { socialLinksSchema } from "./auth.js";

// db/migrations/0065_follow_notify_mode.sql
export const followNotifyModeSchema = z.enum(["all", "personalized", "muted"]);
export type FollowNotifyMode = z.infer<typeof followNotifyModeSchema>;

export const updateFollowNotifyModeSchema = z.object({
  notifyMode: followNotifyModeSchema,
});
export type UpdateFollowNotifyModeInput = z.infer<typeof updateFollowNotifyModeSchema>;

export const followStatusSchema = z.object({
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  // Only meaningful when `following` is true — defaults to 'all' both at
  // the DB layer and here for an unfollowed viewer, matching a fresh
  // follow's own default.
  notifyMode: followNotifyModeSchema,
});
export type FollowStatus = z.infer<typeof followStatusSchema>;

// Category-follow's own lighter shape — no per-creator notify granularity
// makes sense for a category, so this deliberately doesn't reuse
// followStatusSchema now that the two have actually diverged (see
// follows/category-service.ts's own header comment on why it used to
// share the creator-follow type).
export const categoryFollowStatusSchema = z.object({
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type CategoryFollowStatus = z.infer<typeof categoryFollowStatusSchema>;

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
  socialLinks: socialLinksSchema,
  isVerified: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  isFollowing: z.boolean(),
  // Only meaningful when isFollowing is true — 'all' for an anonymous/
  // non-following viewer, same convention as followStatusSchema's own.
  notifyMode: followNotifyModeSchema,
});
export type CreatorProfile = z.infer<typeof creatorProfileSchema>;

// Creator Dashboard's Community > Followers tab — the reverse direction
// of getFollowedCreators (who a user follows), listing who follows a
// creator's own channel instead.
export const followerListItemSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  followedAt: z.string(),
});
export type FollowerListItem = z.infer<typeof followerListItemSchema>;
