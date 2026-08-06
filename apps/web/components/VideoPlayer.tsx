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
  SkipBackIcon,
  SkipForwardIcon,
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

// Below this, don't bother showing the DVR scrubber — right after a
// creator goes live there's only a fragment or two in the playlist, and a
// scrubber spanning ~2 seconds is more visual noise than a usable control.
// Two hls_fragment lengths (infra/srs/conf/srs.conf.template) is a
// reasonable floor, not a precisely tuned one.
const MIN_DVR_RANGE_SECONDS = 4;

// How close to the live edge still counts as "live" for the LIVE
// indicator/button — matters because currentTime updates on its own
// `timeupdate` cadence (browser-throttled, not exact), so an exact
// equality check against dvrRange.end would flicker in and out of "live"
// on every tick even while genuinely caught up.
const LIVE_EDGE_THRESHOLD_SECONDS = 3;

type DvrRange = { start: number; end: number };

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
  const [playheadTime, setPlayheadTime] = useState(0);
  // DVR (rewind) range, in the same media-time coordinate space as
  // video.currentTime. null until the hls.js/native-HLS branch below has
  // enough playlist/seekable info to know it — see each branch's own
  // comment for how it's derived; the two mechanisms are genuinely
  // different (hls.js: manifest-known window from LEVEL_UPDATED, which can
  // include segments not yet downloaded; native Safari: video.seekable,
  // which Safari's own native HLS stack populates directly).
  const [dvrRange, setDvrRange] = useState<DvrRange | null>(null);

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
    setDvrRange(null);

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
    setDvrRange(null);

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
      // Safari's native HLS stack (not hls.js — no MediaSource involved
      // here) populates video.seekable itself from whatever the live
      // playlist currently lists, so reading it directly on every
      // timeupdate is the correct source of truth for this branch, unlike
      // the hls.js branch below which needs LEVEL_UPDATED instead (see
      // that branch's own comment for why).
      const onTimeUpdateNative = () => {
        if (video.seekable.length > 0) {
          setDvrRange({ start: video.seekable.start(0), end: video.seekable.end(0) });
        }
      };
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.addEventListener("stalled", onError);
      video.addEventListener("timeupdate", onTimeUpdateNative);
      video.src = src;
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.removeEventListener("stalled", onError);
        video.removeEventListener("timeupdate", onTimeUpdateNative);
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
    // fragmentStart/edge are LevelDetails getters (confirmed against the
    // installed hls.js's own source, not just its .d.ts) —
    // fragmentStart = this.fragments[0].start, edge = the last fragment's
    // end. Both reflect the full currently-listed playlist window, whether
    // or not every one of those segments has actually been downloaded yet
    // — unlike video.seekable/buffered, which only reflect what's already
    // been fetched into the SourceBuffer. That's the whole reason this
    // uses LEVEL_UPDATED instead of mirroring the native-Safari branch's
    // video.seekable approach: seeking backward into a not-yet-downloaded
    // but still-listed segment is expected to work (hls.js fetches it on
    // demand, same mechanism as any VOD seek), so the scrubber's range
    // needs to reflect the manifest, not the download cache.
    hls.on(Hls.Events.LEVEL_UPDATED, (_event, data) => {
      setDvrRange({ start: data.details.fragmentStart, end: data.details.edge });
    });
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

  // Only meaningful on the hls.js engine: hls.js's own back-buffer (kept
  // around unless evicted, no backBufferLength cap is set — see the hls.js
  // config above) is what actually makes a short rewind land somewhere
  // playable. There is no equivalent for the "whep" engine — a WebRTC
  // MediaStream has no seekable timeline at all, so setting currentTime on
  // it is a silent no-op per spec, not an error; gating the buttons to
  // engine === "hls" avoids shipping a control that looks broken.
  //
  // Not yet verified against a real production stream: whether a full 10s
  // actually lands inside what hls.js has retained, given this player's
  // aggressive low-latency tuning (liveSyncDurationCount: 1,
  // maxBufferLength: 10 — see that config's own comments). If SRS's live
  // playlist window has already rolled the target segment out by the time
  // this fires, the browser will stall trying to fetch it. This needs a
  // real live test before relying on it working every time, same as
  // everything else in this file that's marked "not yet verified live."
  function skip(deltaSeconds: number) {
    const video = videoRef.current;
    if (!video) return;
    // No upper clamp against video.duration — for a live (no #EXT-X-ENDLIST)
    // playlist that's either Infinity (native Safari HLS) or a large,
    // continuously-growing finite number (hls.js's default
    // liveDurationInfinity: false), neither of which is the right bound for
    // "how far forward can I actually seek." The browser already clamps an
    // out-of-range currentTime assignment to the nearest valid point in
    // video.seekable, per spec — no need to duplicate that here.
    video.currentTime = Math.max(video.currentTime + deltaSeconds, 0);
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(e.target.value);
    video.currentTime = next;
    setPlayheadTime(next);
  }

  function jumpToLive() {
    const video = videoRef.current;
    if (!video || !dvrRange) return;
    video.currentTime = dvrRange.end;
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
        onTimeUpdate={(e) => setPlayheadTime(e.currentTarget.currentTime)}
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
        {/* Only once the DVR window is known and wide enough to be useful
            (see MIN_DVR_RANGE_SECONDS) — a scrubber with essentially zero
            range in the first couple seconds of a stream is worse than no
            scrubber at all. Never shown on WHEP: no seekable timeline
            exists for a WebRTC MediaStream, same reasoning as skip(). */}
        {engine === "hls" && dvrRange && dvrRange.end - dvrRange.start >= MIN_DVR_RANGE_SECONDS && (
          <input
            type="range"
            className={styles.scrubber}
            min={dvrRange.start}
            max={dvrRange.end}
            step={0.1}
            value={Math.min(Math.max(playheadTime, dvrRange.start), dvrRange.end)}
            onChange={handleScrub}
            aria-label="Seek within DVR window"
          />
        )}
        <div className={styles.bottomRow}>
          <button type="button" className={styles.controlButton} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          {/* engine === "hls" only — see skip()'s own comment for why a WHEP
              MediaStream has no seekable timeline for these to act on. */}
          {engine === "hls" && (
            <>
              <button type="button" className={styles.controlButton} onClick={() => skip(-10)} aria-label="Back 10 seconds">
                <SkipBackIcon />
              </button>
              <button type="button" className={styles.controlButton} onClick={() => skip(10)} aria-label="Forward 10 seconds">
                <SkipForwardIcon />
              </button>
            </>
          )}
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
          {/* Only shown once we have a DVR range to be behind — otherwise
              redundant with the player just always being live by default. */}
          {engine === "hls" && dvrRange && dvrRange.end - dvrRange.start >= MIN_DVR_RANGE_SECONDS && (
            <button
              type="button"
              className={`${styles.liveButton} ${dvrRange.end - playheadTime <= LIVE_EDGE_THRESHOLD_SECONDS ? styles.liveButtonActive : ""}`}
              onClick={jumpToLive}
              disabled={dvrRange.end - playheadTime <= LIVE_EDGE_THRESHOLD_SECONDS}
            >
              <span className={styles.liveDot} />
              Live
            </button>
          )}
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
    </div>
  );
}
