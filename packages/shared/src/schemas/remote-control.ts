import { z } from "zod";

// Phase 2.2 — remote_control_assistants (db/migrations/0040). Distinct
// from channel-moderation.ts's ChannelModerator: a channel moderator can
// pin/delete chat messages and block viewers; a remote-control assistant
// can drive the broadcast itself (scene/mic/bitrate — see relay.ts's
// command allowlist for the exact, deliberately narrower set setLive/
// setRecord are excluded from). Same shape, same reason to keep it a
// separate table rather than reusing channel_moderator_grants: these are
// different privileges and should be grantable/revocable independently.
export const remoteControlAssistantSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  grantedAt: z.string(),
});
export type RemoteControlAssistant = z.infer<typeof remoteControlAssistantSchema>;

export const grantRemoteControlAssistantSchema = z.object({
  username: z.string().min(1),
});
export type GrantRemoteControlAssistantInput = z.infer<typeof grantRemoteControlAssistantSchema>;
