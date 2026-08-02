import { z } from "zod";

export const socialProviderSchema = z.enum(["google", "apple"]);
export type SocialProvider = z.infer<typeof socialProviderSchema>;

// idToken is the provider's signed ID token from their own client-side SDK
// — verified server-side against the provider's public JWKS (never trust
// it as-is). fullName is Apple-specific: Apple only includes it in the
// *first* authorization response ever, not the ID token itself, so the
// client has to capture and forward it that one time or it's gone for
// good — see auth/social-service.ts.
export const socialAuthSchema = z.object({
  idToken: z.string().min(1),
  fullName: z.string().max(100).optional(),
});
export type SocialAuthInput = z.infer<typeof socialAuthSchema>;

export const linkedSocialAccountSchema = z.object({
  provider: socialProviderSchema,
  email: z.string().nullable(),
  linkedAt: z.string(),
});
export type LinkedSocialAccount = z.infer<typeof linkedSocialAccountSchema>;
