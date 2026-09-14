import type { SocialLinkPlatform, SocialLinks } from "@birq/shared";
import styles from "./SocialLinksRow.module.css";

// Simplified brand glyphs (solid fill, 24x24) — recognizable at the small
// sizes this row renders at, not full reproductions of each brand's mark.
const PLATFORM_ICONS: Record<SocialLinkPlatform, { label: string; path: string }> = {
  twitch: {
    label: "Twitch",
    path: "M4 2 2.5 6v14h5V22l3-2h4l5-4V2H4zm15 11-3 3h-4l-3 2v-2H6V4h13v9z" +
      "M14.5 6.5h2V12h-2zM10 6.5h2V12h-2z",
  },
  twitter: {
    label: "X",
    path: "M4 3h4.2l4 5.6L16.6 3H20l-6.3 8.1L20.4 21h-4.2l-4.4-6.2L6.8 21H3.4l6.7-8.5L4 3z",
  },
  youtube: {
    label: "YouTube",
    path: "M22 8.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C15.9 4.6 12 4.6 12 4.6h0s-3.9 0-6.8.3c-.4 0-1.4.1-2.3 1C2.2 6.6 2 8.2 2 8.2S1.8 10 1.8 11.9v1.7c0 1.9.2 3.7.2 3.7s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.3 7.6.3s3.9 0 6.8-.3c.4-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.7v-1.7C22.2 10 22 8.2 22 8.2zM9.9 15V9l5.8 3-5.8 3z",
  },
  instagram: {
    label: "Instagram",
    path: "M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H8zm4 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.6 6.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z",
  },
  discord: {
    label: "Discord",
    path: "M18.9 5.3A17.6 17.6 0 0 0 14.5 4l-.3.5c1.6.4 2.5.9 3.4 1.5-1.4-.7-2.8-1.1-4.1-1.2a13 13 0 0 0-3 0c-1.4.1-2.8.5-4.1 1.2.9-.6 1.9-1.1 3.4-1.5L9.5 4a17.5 17.5 0 0 0-4.4 1.3C2.6 8.9 2 12.4 2.3 15.8c1.6 1.2 3.2 1.9 4.7 2.3l.6-1c-.8-.3-1.6-.7-2.3-1.2l.3-.2a12.3 12.3 0 0 0 10.8 0l.3.2c-.7.5-1.5.9-2.3 1.2l.6 1c1.5-.4 3.1-1.1 4.7-2.3.4-3.9-.6-7.4-1.8-10.5zM9.2 13.6c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5.6 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z",
  },
  tiktok: {
    label: "TikTok",
    path: "M14.5 3h2.7a5.6 5.6 0 0 0 3.8 4v2.7a8.3 8.3 0 0 1-3.8-1v6.1a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v2.8a3.1 3.1 0 1 0 2.1 2.9V3z",
  },
};

export function SocialLinksRow({ socialLinks }: { socialLinks: SocialLinks }) {
  const entries = Object.entries(socialLinks) as [SocialLinkPlatform, string][];
  if (entries.length === 0) return null;

  return (
    <div className={styles.row}>
      {entries.map(([platform, url]) => {
        const icon = PLATFORM_ICONS[platform];
        if (!icon) return null;
        return (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
            title={icon.label}
            aria-label={icon.label}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d={icon.path} />
            </svg>
          </a>
        );
      })}
    </div>
  );
}
