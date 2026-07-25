"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import styles from "./VideoPlayer.module.css";

type PlaybackState = "connecting" | "playing" | "waiting" | "error";

// How often to retry after the manifest isn't found yet — expected right
// after a creator clicks "Go live" in the dashboard, since that marks the
// stream live in the DB immediately, before their encoder has necessarily
// started actually publishing. Without a retry loop here, hls.js's first
// 404 on the manifest is fatal and it just gives up silently, leaving a
// black <video> element with a duration timer (driven by the DB
// started_at, not by playback) ticking above it — real, live-tested
// behavior, not hypothetical.
const RETRY_INTERVAL_MS = 5000;

export function VideoPlayer({ src }: { src: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlaybackState>("connecting");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setState("connecting");

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // Native HLS is only reliably well-supported when paired with
    // ManagedMediaSource (Safari on iOS 17.1+) — per hls.js's current
    // guidance, browsers can report canPlayType support without actually
    // playing certain streams natively, so gate on both.
    if (video.canPlayType("application/vnd.apple.mpegurl") && "ManagedMediaSource" in window) {
      const onPlaying = () => setState("playing");
      const onError = () => setState("waiting");
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.addEventListener("stalled", onError);
      video.src = src;
      return () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.removeEventListener("stalled", onError);
      };
    }

    if (!Hls.isSupported()) {
      setState("error");
      return;
    }

    const hls = new Hls();

    function attach() {
      hls.loadSource(src!);
      hls.attachMedia(video!);
    }

    hls.on(Hls.Events.MANIFEST_PARSED, () => setState("playing"));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // A manifest 404/timeout means SRS has nothing to serve yet for this
      // stream key — the normal state between "creator clicked Go Live"
      // and "their encoder actually connected," not a real error. Retry
      // instead of giving up. Anything else fatal (media error, etc.) is
      // treated as a genuine failure.
      const isNoStreamYet =
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR);

      if (isNoStreamYet) {
        setState("waiting");
        hls.stopLoad();
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            hls.startLoad();
            attach();
          }
        }, RETRY_INTERVAL_MS);
      } else {
        setState("error");
      }
    });

    attach();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      hls.destroy();
    };
  }, [src]);

  if (!src) {
    return (
      <div className={styles.offline}>
        <span>Stream offline</span>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <video ref={videoRef} className={styles.video} controls playsInline />
      {state !== "playing" && (
        <div className={styles.statusOverlay}>
          <span>
            {state === "connecting" && "Connecting…"}
            {state === "waiting" && "Waiting for the stream to start…"}
            {state === "error" && "Couldn't load this stream."}
          </span>
        </div>
      )}
    </div>
  );
}
