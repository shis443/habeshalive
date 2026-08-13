"use client";

import type { PublicVod } from "@birq/shared";
import Link from "next/link";
import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import { VodPlayer } from "./VodPlayer";
import styles from "./CategoryVodsGrid.module.css";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Phase 3.3 — category detail page's Videos tab. Same card shape as
// PastBroadcasts.tsx (inline-play via VodPlayer, same thumbnail/duration
// convention), but that component's Vod type carries no creator
// attribution — it's always rendered on that creator's own channel page,
// where "whose video is this" is already implied by context. This is a
// cross-creator feed, so it needs a real attribution line/link instead.
export function CategoryVodsGrid({ vods }: { vods: PublicVod[] }) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  if (vods.length === 0) return <p className={styles.empty}>No videos in this category yet.</p>;

  return (
    <div className={styles.grid}>
      {vods.map((vod) => (
        <div key={vod.id} className={styles.card}>
          {playingId === vod.id ? (
            <div className={styles.playerWrap}>
              <VodPlayer src={vod.playbackUrl} poster={vod.thumbnailUrl} vodId={vod.id} />
            </div>
          ) : (
            <button type="button" className={styles.thumbnailButton} onClick={() => setPlayingId(vod.id)}>
              {vod.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vod.thumbnailUrl} alt="" className={styles.thumbnail} />
              ) : (
                <div className={styles.thumbnailPlaceholder} />
              )}
              <span className={styles.viewCount}>
                {vod.views.toLocaleString()} view{vod.views === 1 ? "" : "s"}
              </span>
              {formatDuration(vod.durationSeconds) && (
                <span className={styles.duration}>{formatDuration(vod.durationSeconds)}</span>
              )}
            </button>
          )}
          <p className={styles.title}>{vod.title}</p>
          <Link href={`/watch/${vod.creatorUsername}`} className={styles.creator}>
            {vod.creatorDisplayName}
          </Link>
          <p className={styles.meta}>{formatRelativeTime(vod.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}
