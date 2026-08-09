import { z } from "zod";

// Module 5 — per-channel moderator RBAC, distinct from the platform-wide
// role_permission_grants (schemas/admin.ts's permission keys). A channel
// moderator grant is all-or-nothing per channel (pin/delete messages,
// block viewers from this channel) rather than a second layer of
// per-action permission bits within a channel — the real gap this fills
// is "scoped to one creator's channel," not finer-grained slicing within
// that scope.
export const channelModeratorSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  grantedAt: z.string(),
});
export type ChannelModerator = z.infer<typeof channelModeratorSchema>;

export const grantChannelModeratorSchema = z.object({
  username: z.string().min(1),
});
export type GrantChannelModeratorInput = z.infer<typeof grantChannelModeratorSchema>;

export const channelBlockSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type ChannelBlock = z.infer<typeof channelBlockSchema>;

export const blockViewerSchema = z.object({
  username: z.string().min(1),
});
export type BlockViewerInput = z.infer<typeof blockViewerSchema>;

// Creator Dashboard's Community > My Assigned Roles — the reverse
// direction of channelModeratorSchema above (channels that granted ME
// moderator status, not who I've granted it to on my own channel).
export const moderatedChannelSchema = z.object({
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  creatorDisplayName: z.string(),
  creatorAvatarUrl: z.string().nullable(),
  grantedAt: z.string(),
});
export type ModeratedChannel = z.infer<typeof moderatedChannelSchema>;
