"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { WHEP_ENABLED } from "@/lib/config";
import { connectWhep, type WhepConnection } from "@/lib/whep-client";
import styles from "./VideoPlayer.module.css";
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  MutedIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  TheaterIcon,
  VolumeIcon,
} from "./icons";

type PlaybackState = "connecting" | "playing" | "waiting" | "error";

// Which delivery mechanism is currently attempting/holding playback.
// "whep" is only ever the starting engine (gated by WHEP_ENABLED and a
// streamId being available) — the fallback to "hls" is one-directional:
// once WHEP has failed or timed out for this mount, it's never retried,
// same as the design spec's "one-directional fallback" requirement. This
// intentionally does NOT attempt to fall back the other way (hls -> whep)
// if hls.js itself errors — hls.js's own retry loop (RETRY_INTERVAL_MS
// below) already handles the "stream not up yet" case that's the actual
// common failure mode here.
type Engine = "whep" | "hls";

// How often to retry after the manifest isn't found yet — expected right
// after a creator clicks "Go live" in the dashboard, since that marks the
// stream live in the DB immediately, before their encoder has necessarily
// started actually publishing. Without a retry loop here, hls.js's first
// 404 on the manifest is fatal and it just gives up silently, leaving a
// black <video> element with a duration timer (driven by the DB
// started_at, not by playback) ticking above it — real, live-tested
// behavior, not hypothetical.
const RETRY_INTERVAL_MS = 5000;

// Hard bound on the WHEP attempt before giving up and falling back to
// HLS — deliberately short (this is meant to be the *fast* path; a viewer
// should never wait longer for WHEP to fail than HLS would've taken to
// just start working). ICE reaching "failed" fires the fallback
// immediately, without waiting for this timeout at all — this only
// covers the "never resolves either way" case (e.g. a network that
// silently drops every UDP/TCP candidate rather than cleanly rejecting).
const WHEP_CONNECT_TIMEOUT_MS = 3000;

export function VideoPlayer({ src, streamId }: { src: string | null; streamId?: string | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlaybackState>("connecting");
  const [engine, setEngine] = useState<Engine>(WHEP_ENABLED && streamId ? "whep" : "hls");
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [theater, setTheater] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  useEffect(() => {
    setPipSupported(typeof document !== "undefined" && document.pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Re-picks the starting engine whenever the stream itself changes (a
  // fresh mount for a new src should always get a fresh WHEP attempt, not
  // inherit a previous stream's fallback-to-hls decision).
  useEffect(() => {
    setEngine(WHEP_ENABLED && streamId ? "whep" : "hls");
  }, [src, streamId]);

  // WHEP (WebRTC) attempt — sub-2s playback path. Only runs while
  // engine === "whep"; falling back flips engine to "hls" and this effect
  // never runs again for the current src/streamId (the effect below,
  // gated on engine === "hls", picks up from there using the exact same
  // hls.js/native-HLS logic this app already had before WHEP existed).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || !streamId || engine !== "whep") return;
    setState("connecting");

    let cancelled = false;
    let connection: WhepConnection | null = null;
    let iceConnected = false;
    let firstFrameSeen = false;
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;

    function maybeMarkPlaying() {
      if (iceConnected && firstFrameSeen && !cancelled) setState("playing");
    }

    function fallbackToHls() {
      if (cancelled) return;
      cancelled = true;
      if (hardTimeout) clearTimeout(hardTimeout);
      video!.removeEventListener("loadeddata", onFirstFrame);
      // Clears the WHEP MediaStream before the hls.js effect below assigns
      // video.src — leaving a stale srcObject set is undefined behavior
      // for which source actually drives the element.
      video!.srcObject = null;
      connection?.close().catch(() => {});
      setEngine("hls");
    }

    function onFirstFrame() {
      firstFrameSeen = true;
      maybeMarkPlaying();
    }

    video.addEventListener("loadeddata", onFirstFrame);
    hardTimeout = setTimeout(fallbackToHls, WHEP_CONNECT_TIMEOUT_MS);

    connectWhep(streamId, video)
      .then((conn) => {
        if (cancelled) {
          conn.close().catch(() => {});
          return;
        }
        connection = conn;
        conn.pc.addEventListener("iceconnectionstatechange", () => {
          const iceState = conn.pc.iceConnectionState;
          if (iceState === "connected" || iceState === "completed") {
            iceConnected = true;
            if (hardTimeout) clearTimeout(hardTimeout);
            maybeMarkPlaying();
          } else if (iceState === "failed") {
            // Instant fallback — don't wait for WHEP_CONNECT_TIMEOUT_MS
            // once ICE has definitively failed rather than merely not
            // having resolved yet.
            fallbackToHls();
          }
        });
      })
      .catch(() => {
        // connectWhep's own WhepConnectError covers every failure before/
        // during the broker exchange (network, non-2xx, bad answer) —
        // same fallback as an ICE failure or the hard timeout.
        fallbackToHls();
      });

    return () => {
      cancelled = true;
      if (hardTimeout) clearTimeout(hardTimeout);
      video.removeEventListener("loadeddata", onFirstFrame);
      connection?.close().catch(() => {});
    };
  }, [src, streamId, engine]);

  // HLS (hls.js / native Safari HLS) — unchanged from before WHEP existed,
  // just gated on engine === "hls" so it never runs while a WHEP attempt
  // is still in flight above.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || engine !== "hls") return;
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
    const hls = new Hls({
      // Inert today, not decorative — the SRS version this app runs
      // (verified against the actual server source, not assumed) has no
      // #EXT-X-PART/blocking-reload support, so this manifest never
      // triggers hls.js's LL-HLS code path; it just falls back to normal
      // segment-based playback. Left on for forward compatibility only,
      // in case that ever changes — see docs/hls-latency-testing.md for
      // why 1-3s glass-to-glass isn't reachable via HLS at all regardless
      // of this flag, on this server or any other — WHEP above is the
      // real sub-2s path now, this is strictly the fallback engine.
      lowLatencyMode: true,
      // Demux/remux off the main thread — real perf win (fewer dropped
      // frames / stall-inducing jank), not latency-specific on its own.
      enableWorker: true,
      // Trimmed further from 2 (see comment above) to 1 — the most
      // aggressive value before rebuffer risk rises sharply on a rough
      // connection. Unlike the "2" value above, this hasn't been verified
      // against a real stream yet — check docs/hls-latency-testing.md's
      // rebuffer-count metric specifically after this change, don't
      // assume it's a clean win.
      liveSyncDurationCount: 1,
      // Default is 30s of forward buffer — pure added latency risk on a
      // live stream if the player ever falls behind and fills it. Capped
      // to roughly 2-3 segments' worth instead. Also unverified live yet.
      maxBufferLength: 10,
      // When the player falls behind the live edge (past liveSyncDuration)
      // hls.js nudges playback rate up to this multiplier to catch back up
      // smoothly, then returns to 1x — real automatic catch-up, not just a
      // buffer-size tweak. (hls.js >=1.5, confirmed against this repo's
      // installed version in apps/web/package.json.)
      maxLiveSyncPlaybackRate: 1.2,
    });

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
  }, [src, engine]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    // Unmuting at 0 volume would just be silent again — give it an
    // audible starting point, same as every comparable player does.
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

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP can reject (e.g. no video data yet) — not worth surfacing as
      // an error state, the button just stays clickable to retry.
    }
  }

  if (!src) {
    return (
      <div className={styles.offline}>
        <span>Stream offline</span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${theater ? styles.theater : ""}`}>
      {/* autoPlay+muted is the one autoplay pattern every major browser's
          autoplay policy actually permits without a user gesture first —
          unmuted autoplay is blocked outright in Chrome/Firefox/Safari, so
          this isn't a preference, it's the only combination that starts
          playback without requiring a click. Native `controls` is gone in
          favor of the custom bar below (D.1) — onClick still toggles
          play/pause the same way clicking a native player does. Works
          identically for both engines: WHEP assigns video.srcObject, HLS
          assigns video.src, but it's the same <video> element either way. */}
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        autoPlay
        muted
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {state !== "playing" && (
        <div className={styles.statusOverlay}>
          <span>
            {state === "connecting" && "Connecting…"}
            {state === "waiting" && "Waiting for the stream to start…"}
            {state === "error" && "Couldn't load this stream."}
          </span>
        </div>
      )}
      <div className={styles.controls}>
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
        {/* Only one HLS rendition exists today (see infra/srs's comment on
            why — no transcode{} block configured) — "Auto" is honestly the
            only real option, not a fake selector with dead entries. */}
        <span className={styles.qualityLabel}>Auto</span>
        <span className={styles.spacer} />
        {pipSupported && (
          <button type="button" className={styles.controlButton} onClick={togglePip} aria-label="Picture in picture">
            <PipIcon />
          </button>
        )}
        <button
          type="button"
          className={`${styles.controlButton} ${theater ? styles.controlButtonActive : ""}`}
          onClick={() => setTheater((t) => !t)}
          aria-label="Theater mode"
          aria-pressed={theater}
        >
          <TheaterIcon />
        </button>
        <button type="button" className={styles.controlButton} onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
      </div>
    </div>
  );
}
