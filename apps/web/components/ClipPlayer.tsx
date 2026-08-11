"use client";

import { useRef } from "react";
import styles from "./ClipPlayer.module.css";

// Deliberately minimal compared to VodPlayer.tsx — a clip is capped at
// MAX_CLIP_DURATION_SECONDS (60s, packages/shared/src/schemas/clips.ts),
// so a scrubber/skip-10s/theater-mode control surface built for hour-long
// VODs would be more chrome than the content justifies. Native `controls`
// is enough here.
export function ClipPlayer({ src, clipId }: { src: string; clipId: string }) {
  const viewRecorded = useRef(false);

  function recordView() {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    // Same "count a play, not a page load" convention as VodPlayer.tsx's
    // own recordView — best-effort, a failed beacon shouldn't interrupt
    // playback or surface an error over something this inconsequential.
    fetch(`/api/backend/vods/clips/${clipId}/view`, { method: "POST" }).catch(() => {});
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      className={styles.video}
      src={src}
      controls
      playsInline
      onPlay={recordView}
    />
  );
}
