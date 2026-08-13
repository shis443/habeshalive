import type { PublicClip } from "@birq/shared";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/format";
import styles from "./CategoryClipsGrid.module.css";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Phase 3.3 — category detail page's Clips tab. Unlike CategoryVodsGrid
// (inline play — there's no standalone public VOD page to send a viewer
// to), each card here links out to the real /clip/[id] page instead of
// playing inline: that page already exists, already has the real player,
// share sheet, and attribution (Phase 3.1) — duplicating playback logic
// here a third time would just be worse maintenance for no real benefit,
// since a discovery/browse surface is exactly where sending a viewer
// through to the shareable page is the right outcome anyway.
export function CategoryClipsGrid({ clips }: { clips: PublicClip[] }) {
  if (clips.length === 0) return <p className={styles.empty}>No clips in this category yet.</p>;

  return (
    <div className={styles.grid}>
      {clips.map((clip) => (
        <Link key={clip.id} href={`/clip/${clip.id}`} className={styles.card}>
          <div className={styles.thumbnail}>
            {clip.ogImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clip.ogImageUrl} alt="" className={styles.thumbnailImage} />
            ) : null}
            <span className={styles.viewCount}>
              {clip.views.toLocaleString()} view{clip.views === 1 ? "" : "s"}
            </span>
            <span className={styles.duration}>{formatDuration(clip.durationSeconds)}</span>
          </div>
          {clip.title && <p className={styles.title}>{clip.title}</p>}
          <p className={styles.creator}>{clip.creatorDisplayName}</p>
          <p className={styles.meta}>{formatRelativeTime(clip.createdAt)}</p>
        </Link>
      ))}
    </div>
  );
}
