// Placeholder stream thumbnail, generated on the fly when a creator skips
// uploading one — same reasoning as avatarRender.ts's flat-swatch avatars:
// a real design asset can replace this later without touching the
// data model, since callers only ever see a URL.

const CATEGORY_COLORS: Record<string, string> = {
  Music: "#8b2fc9",
  Gaming: "#2f6fc9",
  Traditional: "#c97c2f",
  "Just Chatting": "#2fae7a",
};
const DEFAULT_COLOR = "#3a3f52";

export function renderThumbnailPlaceholderSvg(category: string): string {
  const color = CATEGORY_COLORS[category] ?? DEFAULT_COLOR;
  const label = category || "Live";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.9" />
      <stop offset="1" stop-color="#12141f" stop-opacity="0.95" />
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)" />
  <text x="320" y="190" font-family="sans-serif" font-size="36" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="0.85">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}
