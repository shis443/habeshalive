"use client";

import Hls from "hls.js";
import { useEffect, useRef } from "react";
import styles from "./StreamCardPreview.module.css";

// Module-level, shared across every mounted StreamCardPreview — a big
// grid can have many cards simultaneously "visible" (any part of them on
// screen), and starting an HLS decode for every single one at once is a
// real bandwidth/CPU problem real platforms specifically guard against,
// not a hypothetical. Caps how many previews actually decode video at
// once; everything past the cap just keeps showing its static thumbnail
// even while "visible", same as the fallback state for autoplay being
// blocked or the stream having no playbackUrl at all.
const MAX_CONCURRENT_PREVIEWS = 4;
let activePreviewCount = 0;

// The full VideoPlayer.tsx (823 lines: WHEP+HLS dual engine, DVR
// scrubber, fullscreen/PiP/theater controls, heartbeat tracking) is built
// for the one dedicated watch page a viewer commits to — instantiating
// that per card in a directory grid would mean dozens of simultaneous
// WebRTC/HLS connections for a feature that's just meant to be a silent,
// muted preview. This is the minimal version: no controls, no WHEP, plain
// hls.js defaults (a preview doesn't need the main player's aggressive
// low-latency tuning), playing only while `active` and torn down
// completely otherwise so an off-screen card holds no decoder or network
// connection.
export function StreamCardPreview({
  playbackUrl,
  active,
  onPlaying,
}: {
  playbackUrl: string;
  active: boolean;
  onPlaying: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;

    // A local variable, not React state: this closure's own cleanup
    // needs to know whether THIS invocation specifically incremented the
    // shared counter, and state updates aren't visible synchronously
    // within the same effect run — a state-based version would capture a
    // stale value in the cleanup below instead of this run's own.
    let claimedSlot = false;
    if (activePreviewCount >= MAX_CONCURRENT_PREVIEWS) {
      return;
    }
    activePreviewCount += 1;
    claimedSlot = true;

    let hls: Hls | null = null;
    function handlePlaying() {
      onPlaying();
    }
    video.addEventListener("playing", handlePlaying);

    // Same gate as VideoPlayer.tsx's proven one, and for the exact same
    // documented reason (hls.js's own guidance): canPlayType alone can
    // report support without the browser actually being able to play a
    // live manifest — confirmed live here too, not just in that file's
    // comment. Without the ManagedMediaSource check, this branch was
    // taken by a Chromium build that claimed HLS support, set video.src
    // directly to the raw manifest, and then never decoded a single
    // frame — readyState stuck at 0, videoWidth/videoHeight both 0,
    // permanently blank despite .ts segment requests actually firing.
    if (video.canPlayType("application/vnd.apple.mpegurl") && "ManagedMediaSource" in window) {
      // Safari/iOS 17.1+ decode HLS natively — no hls.js needed or wanted here.
      video.src = playbackUrl;
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
    } else {
      activePreviewCount -= 1;
      return;
    }
    video.play().catch(() => {
      // Autoplay blocked (rare for a muted <video>, but real on some
      // mobile browsers/low-power-mode) — the thumbnail this sits behind
      // just stays visible, which is a fine fallback, not an error state.
    });

    return () => {
      video.removeEventListener("playing", handlePlaying);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      if (claimedSlot) {
        activePreviewCount -= 1;
      }
    };
  }, [active, playbackUrl, onPlaying]);

  return <video ref={videoRef} className={styles.video} muted playsInline aria-hidden="true" />;
}
