"use client";

import type { Vod } from "@birq/shared";
import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import styles from "./PastBroadcasts.module.css";
import { VodPlayer } from "./VodPlayer";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PastBroadcasts({ vods }: { vods: Vod[] }) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  if (vods.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Past broadcasts</h2>
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
            <p className={styles.meta}>{formatRelativeTime(vod.createdAt)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
