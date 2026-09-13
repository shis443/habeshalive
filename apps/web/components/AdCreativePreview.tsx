"use client";

import type { ServedAdSlot } from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import styles from "./AdCreativePreview.module.css";

function recordClick(impressionId: string) {
  fetch(`/api/backend/ads/${impressionId}/click`, { method: "POST" }).catch(() => {});
}

function recordCompletion(impressionId: string, completedSeconds: number, skipped: boolean) {
  fetch(`/api/backend/ads/${impressionId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completedSeconds, skipped }),
  }).catch(() => {});
}

// The one "ad skin" both the real viewer pre-roll (interactive) and the
// admin's live upload preview (non-interactive) render — see the ad-engine
// plan's "one shared component, two consumers" design note. Non-interactive
// mode shows the same chrome as a static label (no running countdown, no
// gating) so what an admin sees while uploading matches what a viewer will
// see, without needing a second implementation to keep in sync.
export function AdCreativePreview({
  ad,
  interactive,
  onDone,
}: {
  ad: ServedAdSlot;
  interactive: boolean;
  onDone?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmuteTap, setNeedsUnmuteTap] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!interactive) return;
    doneRef.current = false;
    setSecondsElapsed(0);
    setNeedsUnmuteTap(false);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.muted = false;
    // Browsers routinely block unmuted autoplay outside a direct user
    // gesture — a stream-page navigation is usually enough of one, but
    // when it isn't, fall back to muted autoplay so the ad still visibly
    // plays rather than sitting on a black frame, with an affordance to
    // turn sound on.
    video.play().catch(() => {
      video.muted = true;
      setNeedsUnmuteTap(true);
      video.play().catch(() => {});
    });
  }, [interactive, ad.impressionId]);

  useEffect(() => {
    if (!interactive) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (video) setSecondsElapsed(Math.floor(video.currentTime));
    }, 250);
    return () => window.clearInterval(id);
  }, [interactive, ad.impressionId]);

  function finish(completedSeconds: number, skipped: boolean) {
    if (doneRef.current) return; // guards a skip click racing the natural onEnded event
    doneRef.current = true;
    recordCompletion(ad.impressionId, completedSeconds, skipped);
    onDone?.();
  }

  function handleEnded() {
    if (!interactive) return;
    finish(Math.floor(videoRef.current?.duration ?? secondsElapsed), false);
  }

  function handleSkip() {
    if (!interactive) return;
    finish(secondsElapsed, true);
  }

  const canSkipNow = interactive && ad.skippableAfterSeconds !== null && secondsElapsed >= ad.skippableAfterSeconds;
  const secondsUntilSkip =
    interactive && ad.skippableAfterSeconds !== null ? Math.max(0, ad.skippableAfterSeconds - secondsElapsed) : null;
  const secondsRemaining = Math.max(0, (ad.durationSeconds ?? 0) - secondsElapsed);

  return (
    <div className={styles.wrap}>
      <video
        ref={videoRef}
        className={styles.video}
        src={ad.assetUrl}
        controls={!interactive}
        loop={!interactive}
        muted={!interactive}
        playsInline
        onEnded={handleEnded}
      />

      <div className={styles.chrome}>
        <span className={styles.badge}>Ad · {ad.advertiserName}</span>
        {interactive ? (
          canSkipNow ? (
            <button type="button" className={styles.skipButton} onClick={handleSkip}>
              Skip Ad
            </button>
          ) : ad.skippableAfterSeconds === null ? (
            <span className={styles.timer}>{secondsRemaining}s</span>
          ) : (
            <span className={styles.timer}>Skip in {secondsUntilSkip}s</span>
          )
        ) : (
          <span className={styles.timer}>
            {ad.skippableAfterSeconds === null ? "Mandatory" : `Skippable after ${ad.skippableAfterSeconds}s`}
          </span>
        )}
      </div>

      {interactive && needsUnmuteTap && (
        <button
          type="button"
          className={styles.unmuteButton}
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = false;
            setNeedsUnmuteTap(false);
          }}
        >
          🔇 Tap to unmute
        </button>
      )}

      {ad.clickUrl && (
        <a
          href={ad.clickUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className={styles.clickThrough}
          onClick={() => interactive && recordClick(ad.impressionId)}
        >
          Learn more about {ad.advertiserName}
        </a>
      )}
    </div>
  );
}
