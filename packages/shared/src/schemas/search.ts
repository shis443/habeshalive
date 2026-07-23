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

export const searchResultsSchema = z.object({
  streams: z.array(streamDetailSchema),
  creators: z.array(creatorSearchResultSchema),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
