import { API_BASE_URL } from "./config";

// avatar_url is stored as a path relative to the API server
// (e.g. "/avatars/render/{userId}.svg"), not the Next.js app — resolve it
// to an absolute URL wherever it's rendered as an <img src>.
export function resolveAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) return avatarUrl;
  return `${API_BASE_URL}${avatarUrl}`;
}
