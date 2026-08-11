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

// Phase 3.5 — /following's new-content badge. A new type rather than
// adding hasNewContent onto creatorSearchResultSchema itself: that type
// is also used by /search's real creator results, where "new content
// since I last visited /following" isn't a meaningful concept at all.
export const followedCreatorSchema = creatorSearchResultSchema.extend({
  hasNewContent: z.boolean(),
});
export type FollowedCreator = z.infer<typeof followedCreatorSchema>;

export const searchResultsSchema = z.object({
  streams: z.array(streamDetailSchema),
  creators: z.array(creatorSearchResultSchema),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
