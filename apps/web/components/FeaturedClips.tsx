"use client";

import type { Clip } from "@birq/shared";
import { useState } from "react";
import styles from "./FeaturedClips.module.css";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Real clips (apps/api/src/vods/clip-service.ts), replacing the earlier
// dashed-card placeholder now that a real clip system exists — see this
// repo's git history for FeaturedClipsPlaceholder.tsx's own reasoning on
// why a placeholder was the deliberate choice before Module 4.
export function FeaturedClips({ clips }: { clips: Clip[] }) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  if (clips.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Clips</h2>
      <div className={styles.row}>
        {clips.map((clip) => (
          <div key={clip.id} className={styles.card}>
            {playingId === clip.id ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video className={styles.video} src={clip.playbackUrl} controls autoPlay playsInline />
            ) : (
              <button type="button" className={styles.playButton} onClick={() => setPlayingId(clip.id)}>
                <span className={styles.duration}>{formatDuration(clip.durationSeconds)}</span>
              </button>
            )}
            {clip.title && <p className={styles.title}>{clip.title}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
