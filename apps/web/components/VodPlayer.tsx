"use client";

import { useEffect, useRef, useState } from "react";
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  MutedIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
} from "./icons";
import styles from "./VodPlayer.module.css";

const SKIP_SECONDS = 10;

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = h > 0 ? m.toString().padStart(2, "0") : m.toString();
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function VodPlayer({ src, poster, vodId }: { src: string; poster?: string | null; vodId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  // Fires once per mount, not once per play/pause toggle — a viewer
  // scrubbing/pausing/resuming mid-watch is still one view, matching the
  // "count a play, not a play event" convention vods/routes.ts's own
  // comment on POST /:id/view describes.
  const viewRecorded = useRef(false);

  function recordView() {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    fetch(`/api/backend/vods/${vodId}/view`, { method: "POST" }).catch(() => {
      // Best-effort — a failed view-count beacon shouldn't interrupt
      // playback or surface an error to the viewer over something this
      // inconsequential.
    });
  }

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function skip(deltaSeconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(video.currentTime + deltaSeconds, 0), video.duration);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(e.target.value);
    video.currentTime = next;
    setCurrentTime(next);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && volume === 0) {
      video.volume = 1;
      setVolume(1);
    }
  }

  function handleVolumeChange(next: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  }

  async function toggleFullscreen() {
    if (!wrapRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await wrapRef.current.requestFullscreen();
    }
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        className={styles.video}
        playsInline
        autoPlay
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          recordView();
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      <div className={styles.centerControls}>
        <button type="button" className={styles.skipButton} onClick={() => skip(-SKIP_SECONDS)} aria-label={`Back ${SKIP_SECONDS} seconds`}>
          <SkipBackIcon />
          <span className={styles.skipLabel}>-{SKIP_SECONDS}s</span>
        </button>
        <button type="button" className={styles.playButton} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className={styles.skipButton} onClick={() => skip(SKIP_SECONDS)} aria-label={`Forward ${SKIP_SECONDS} seconds`}>
          <SkipForwardIcon />
          <span className={styles.skipLabel}>+{SKIP_SECONDS}s</span>
        </button>
      </div>

      <div className={styles.controls}>
        <input
          type="range"
          className={styles.scrubber}
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          aria-label="Seek"
        />
        <div className={styles.bottomRow}>
          <button type="button" className={styles.controlButton} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className={styles.controlButton} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <MutedIcon /> : <VolumeIcon />}
          </button>
          <input
            type="range"
            className={styles.volumeSlider}
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            aria-label="Volume"
          />
          <span className={styles.timeLabel}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <span className={styles.spacer} />
          <button type="button" className={styles.controlButton} onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}
