"use client";

import Hls from "hls.js";
import { useEffect, useRef } from "react";
import styles from "./VideoPlayer.module.css";

export function VideoPlayer({ src }: { src: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Native HLS is only reliably well-supported when paired with
    // ManagedMediaSource (Safari on iOS 17.1+) — per hls.js's current
    // guidance, browsers can report canPlayType support without actually
    // playing certain streams natively, so gate on both.
    if (video.canPlayType("application/vnd.apple.mpegurl") && "ManagedMediaSource" in window) {
      video.src = src;
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
  }, [src]);

  if (!src) {
    return (
      <div className={styles.offline}>
        <span>Stream offline</span>
      </div>
    );
  }

  return <video ref={videoRef} className={styles.video} controls playsInline />;
}
