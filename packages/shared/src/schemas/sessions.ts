import { z } from "zod";

// E.2 multi-session. Deliberately NO token field here — this is what the
// server exposes to client components, and the actual JWTs never leave
// the httpOnly session cookie (see apps/web/lib/session.ts). The account
// switcher UI works off this metadata only; switching itself is a POST to
// a Next.js route handler that reads/writes the cookie server-side.
export const sessionAccountSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isActive: z.boolean(),
  isStale: z.boolean(),
});
export type SessionAccount = z.infer<typeof sessionAccountSchema>;

export const sessionAccountListSchema = z.array(sessionAccountSchema);

export const switchAccountSchema = z.object({
  userId: z.string().uuid(),
});
export type SwitchAccountInput = z.infer<typeof switchAccountSchema>;

export const removeAccountSchema = z.object({
  userId: z.string().uuid(),
});
export type RemoveAccountInput = z.infer<typeof removeAccountSchema>;
