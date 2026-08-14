import { z } from "zod";
import { streamDetailSchema } from "./streams.js";

export const creatorSearchResultSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  category: z.string().nullable(),
  isLive: z.boolean(),
});
export type CreatorSearchResult = z.infer<typeof creatorSearchResultSchema>;

// Phase B — /following's unseen-content counter is intentionally a distinct
// follow-feed field, not a flag bolted onto the generic creator result type.
// The value is the real number of VODs + clips published since the viewer's
// last visit to /following.
export const followedCreatorSchema = creatorSearchResultSchema.extend({
  newContentCount: z.number().int().nonnegative(),
  currentStream: streamDetailSchema.nullable().optional(),
});
export type FollowedCreator = z.infer<typeof followedCreatorSchema>;

export const searchResultsSchema = z.object({
  streams: z.array(streamDetailSchema),
  creators: z.array(creatorSearchResultSchema),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
