import { z } from "zod";
import { liveStreamSchema } from "./streams.js";

// Module 3 — grid-view squad co-streaming. A squad member's `stream` is
// null when that member's own broadcast has ended but they haven't
// explicitly left the squad yet (see squad-service.ts) — the grid just
// shows that tile as offline rather than dropping it, so the layout
// doesn't jump around every time one member's stream blips.
export const squadMemberSchema = z.object({
  creatorId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  stream: liveStreamSchema.nullable(),
});
export type SquadMember = z.infer<typeof squadMemberSchema>;

export const squadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  inviteCode: z.string(),
  members: z.array(squadMemberSchema),
});
export type Squad = z.infer<typeof squadSchema>;

export const createSquadSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});
export type CreateSquadInput = z.infer<typeof createSquadSchema>;

export const joinSquadSchema = z.object({
  inviteCode: z.string().min(1),
});
export type JoinSquadInput = z.infer<typeof joinSquadSchema>;
