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
      // Unlike hls.js below, native playback gives no structured error
      // detail — just "it didn't work". Since the same "no manifest yet"
      // window applies here too (a creator's stream can take 30-50s after
      // going live before SRS has anything to serve — real, measured
      // behavior, not a guess), retry on a timer instead of treating the
      // first failure as final. Without this, Safari loads video.src once,
      // that 404s during the startup window, and the player is stuck on
      // "waiting" forever with no way to recover — confirmed live: a real
      // viewer on iOS Safari never saw a genuinely-live stream because of
      // exactly this.
      const onError = () => {
        setState("waiting");
        retryTimer = setTimeout(() => {
          if (!cancelled) video.src = src!;
        }, RETRY_INTERVAL_MS);
      };
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.addEventListener("stalled", onError);
      video.src = src;
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.removeEventListener("stalled", onError);
      };
    }

    if (!Hls.isSupported()) {
      setState("error");
      return;
    }

    // hls.js's default targets 3 full segments behind the live edge before
    // it'll play — at this stream's actual segment length (encoder
    // keyframe interval puts it around ~6s, not the 4s hls_fragment target
    // in infra/srs/conf/srs.conf.template; segments can only be cut on a
    // keyframe) that's ~18s of built-in latency on top of encode/package
    // time. Trimming to 2 segments trades a bit of rebuffer risk on a rough
    // network for meaningfully lower glass-to-glass delay — real, measured
    // latency was reported as ~10s at the default of 3.
    const hls = new Hls({ liveSyncDurationCount: 2 });

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
      {/* autoPlay+muted is the one autoplay pattern every major browser's
          autoplay policy actually permits without a user gesture first —
          unmuted autoplay is blocked outright in Chrome/Firefox/Safari, so
          this isn't a preference, it's the only combination that starts
          playback without requiring a click. `controls` still gives an
          explicit, always-visible way to unmute/pause/play manually. */}
      <video ref={videoRef} className={styles.video} controls playsInline autoPlay muted />
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
