import type { CreatorSearchResult, StreamDetail } from "@habeshalive/shared";
import { pool } from "../common/db.js";

// Builds a prefix-matching tsquery ("gam" -> "gam:*") so search-as-you-type
// works — plain to_tsquery/websearch_to_tsquery only match whole lexemes.
// Strips anything that isn't a letter or digit (Unicode-aware, so Amharic
// input passes through) before building the query string: user input
// shouldn't be handing tsquery's own mini-language (&, |, !, parens)
// operators to construct, even though it can't reach arbitrary SQL since
// this is always a bound parameter, never concatenated into the query text.
function buildPrefixTsQuery(query: string): string | null {
  const words = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

interface StreamSearchRow {
  id: string;
  title: string;
  category: string | null;
  language: string | null;
  thumbnail_url: string | null;
  playback_url: string | null;
  started_at: string | null;
  status: string;
  peak_viewers: number;
  creator_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_boosted: boolean;
  is_sensitive: boolean;
}

// viewerId gates labeled (is_sensitive) streams the same way
// streams/service.ts's listLiveStreams does — see db/migrations/0012.
export async function searchStreams(query: string, limit = 20, viewerId?: string): Promise<StreamDetail[]> {
  const tsquery = buildPrefixTsQuery(query);
  if (!tsquery) return [];

  const { rows } = await pool.query<StreamSearchRow>(
    `SELECT s.id, s.title, s.category, s.language, s.thumbnail_url, s.playback_url,
            s.started_at, s.status, s.peak_viewers, s.is_sensitive,
            u.id AS creator_id, u.username, u.display_name, u.avatar_url, u.bio,
            EXISTS (
              SELECT 1 FROM stream_boosts b WHERE b.creator_id = s.creator_id AND b.ends_at > now()
            ) AS is_boosted
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.status = 'live' AND s.search_vector @@ to_tsquery('simple', $1)
       AND (s.is_sensitive = FALSE OR EXISTS (
         SELECT 1 FROM users v WHERE v.id = $3 AND v.show_sensitive_content = TRUE
       ))
     ORDER BY is_boosted DESC, ts_rank(s.search_vector, to_tsquery('simple', $1)) DESC
     LIMIT $2`,
    [tsquery, limit, viewerId ?? null]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    language: row.language,
    thumbnailUrl: row.thumbnail_url,
    playbackUrl: row.playback_url,
    startedAt: row.started_at,
    status: row.status as StreamDetail["status"],
    viewerCount: row.peak_viewers,
    isBoosted: row.is_boosted,
    isSensitive: row.is_sensitive,
    creator: {
      id: row.creator_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
    },
  }));
}

interface CreatorSearchRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  category: string | null;
  is_live: boolean;
}

export async function searchCreators(query: string, limit = 20): Promise<CreatorSearchResult[]> {
  const tsquery = buildPrefixTsQuery(query);
  if (!tsquery) return [];

  const { rows } = await pool.query<CreatorSearchRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, cp.category,
            EXISTS (SELECT 1 FROM streams s WHERE s.creator_id = u.id AND s.status = 'live') AS is_live
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE u.role = 'creator' AND u.search_vector @@ to_tsquery('simple', $1)
     ORDER BY ts_rank(u.search_vector, to_tsquery('simple', $1)) DESC
     LIMIT $2`,
    [tsquery, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    category: row.category,
    isLive: row.is_live,
  }));
}
