import { API_BASE_URL } from "./config";

// avatar_url is stored as a path relative to the API server
// (e.g. "/avatars/render/{userId}.svg"), not the Next.js app — resolve it
// to an absolute URL wherever it's rendered as an <img src>.
export function resolveAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) return avatarUrl;
  return `${API_BASE_URL}${avatarUrl}`;
}

// avatar_parts.name holds the literal @dicebear/avataaars option key for
// style categories (e.g. "shortRound", "beardMajestic") — this repo has
// no separate human-label column for them (see db/migrations/0029_
// avataaars_render.sql's comment for why), so AvatarPartGrid.tsx
// humanizes the key directly for display rather than storing the same
// information twice.
export function formatAvatarOptionLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/(\d+)/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).trim();
}
