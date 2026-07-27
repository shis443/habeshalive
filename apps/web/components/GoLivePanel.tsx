"use client";

import { BOOST_PRICE_SANTIM, boostStreamResponseSchema, formatSantimAsBirr, streamDetailSchema } from "@habeshalive/shared";
import { useEffect, useRef, useState } from "react";
import { SRS_WHIP_URL } from "@/lib/config";
import { StreamKeyRow } from "./StreamKeyRow";
import styles from "./GoLivePanel.module.css";

type Method = "obs" | "browser";
type BrowserPhase = "idle" | "previewing" | "starting" | "live" | "error";

function buildWhipUrl(streamKey: string): string {
  const url = new URL(SRS_WHIP_URL);
  url.searchParams.set("app", "live");
  url.searchParams.set("stream", streamKey);
  // No `eip` param here on purpose — SRS's rtc_server.candidate (see
  // infra/srs/fly.toml's SRS_WEBRTC_CANDIDATE) already advertises the
  // correct public ip:port on its own. Passing `eip` too used to add a
  // second, *broken* candidate: browsers correctly percent-encode the
  // colon in "ip:port" (%3A), but SRS doesn't decode the query param
  // before using it, producing a candidate built from the literal string
  // "1.2.3.4%3A8000". Confirmed live, this made real-camera publish
  // attempts flaky — succeeding on some tries, DTLS-hanging on others.
  return url.toString();
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    // Don't wait forever for a straggler candidate — SRS accepts an offer
    // with fewer candidates fine, this just bounds worst-case latency
    // before the WHIP POST fires.
    setTimeout(resolve, 3000);
  });
}

export function GoLivePanel({
  rtmpUrl,
  streamKey,
  displayName,
  initialIsLive,
}: {
  rtmpUrl: string;
  streamKey: string;
  displayName: string;
  initialIsLive: boolean;
}) {
  const [method, setMethod] = useState<Method>("obs");
  const [isLive, setIsLive] = useState(initialIsLive);
  const [ending, setEnding] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [boostError, setBoostError] = useState<string | null>(null);
  const [boostedUntil, setBoostedUntil] = useState<string | null>(null);

  const [obsLoading, setObsLoading] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const whipSessionUrlRef = useRef<string | null>(null);
  const [browserPhase, setBrowserPhase] = useState<BrowserPhase>("idle");
  const [browserError, setBrowserError] = useState<string | null>(null);

  // Camera/mic + any open publish session must not survive a navigation
  // away from this page — leaving them open would keep the tab's camera
  // light on and, worse, keep publishing indefinitely with nothing to stop
  // it (there's no server-side timeout for a WHIP session by itself).
  useEffect(() => {
    return () => {
      cleanupMedia();
      cleanupPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The <video> element only exists in the DOM once browserPhase moves off
  // "idle" — setting srcObject directly inside handleStartCamera races the
  // mount, since that runs before the setBrowserPhase("previewing") below
  // has actually re-rendered. This effect re-attaches whenever phase
  // changes, once the element genuinely exists.
  useEffect(() => {
    if (browserPhase !== "idle" && videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [browserPhase]);

  function cleanupMedia() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function cleanupPeer() {
    peerRef.current?.close();
    peerRef.current = null;
  }

  async function handleObsGoLive() {
    setObsLoading(true);
    setObsError(null);
    try {
      const res = await fetch("/api/backend/streams/go-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${displayName} is live` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to go live");
      streamDetailSchema.parse(data);
      setIsLive(true);
    } catch (err) {
      setObsError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setObsLoading(false);
    }
  }

  async function handleStartCamera() {
    setBrowserError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      setBrowserPhase("previewing");
    } catch (err) {
      setBrowserError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera/microphone access was denied — allow it in your browser's site settings to go live this way."
          : "Couldn't access your camera/microphone."
      );
      setBrowserPhase("error");
    }
  }

  async function handleBrowserGoLive() {
    const mediaStream = mediaStreamRef.current;
    if (!mediaStream) return;
    setBrowserError(null);
    setBrowserPhase("starting");
    try {
      // Same title-setting step the OBS flow's "Go live" button does — WHIP
      // publishing below would also mark the stream live on its own (via
      // SRS's on_publish webhook, same as RTMP), but only this call sets a
      // proper title instead of the generic webhook-only fallback.
      const goLiveRes = await fetch("/api/backend/streams/go-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${displayName} is live` }),
      });
      const goLiveData = await goLiveRes.json();
      if (!goLiveRes.ok) throw new Error(goLiveData.error ?? "Failed to start the stream");
      streamDetailSchema.parse(goLiveData);

      const pc = new RTCPeerConnection();
      peerRef.current = pc;
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

      // The WHIP POST succeeding only means signaling worked — the actual
      // media/DTLS handshake happens after, and can still fail (e.g. an
      // unreachable ICE candidate). Wait for the real connection state
      // instead of declaring victory right after setRemoteDescription. 30s,
      // not something tighter: verified live that a real-world path
      // (through Vercel's edge, real internet routing to Fly) can take
      // noticeably longer to finish ICE/DTLS than a direct/local path.
      const connected = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out connecting to the stream server")), 30000);
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "connected") {
            clearTimeout(timeout);
            resolve();
          } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            clearTimeout(timeout);
            reject(new Error("Lost connection to the stream server"));
          }
        });
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const whipRes = await fetch(buildWhipUrl(streamKey), {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription!.sdp,
      });
      if (!whipRes.ok) throw new Error(`Stream server rejected the connection (${whipRes.status})`);
      const answerSdp = await whipRes.text();
      whipSessionUrlRef.current = whipRes.headers.get("Location");
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      await connected;
      setBrowserPhase("live");
      setIsLive(true);

      // If the connection drops later (network blip, ICE renegotiation
      // failure), reflect that instead of leaving a stale "Live" badge up.
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          cleanupPeer();
          cleanupMedia();
          setBrowserError("Lost connection to the stream server.");
          setBrowserPhase("error");
          setIsLive(false);
        }
      });
    } catch (err) {
      cleanupPeer();
      setBrowserError(err instanceof Error ? err.message : "Failed to go live");
      setBrowserPhase("error");
    }
  }

  async function handleEndStream() {
    setEnding(true);
    // Best-effort WHIP teardown (tells SRS to close the session immediately
    // instead of waiting for the connection to time out) — not
    // awaited-and-thrown-on-failure, since the DB-side end-stream call
    // below is what actually matters for the rest of the app. A no-op if
    // the stream was started via OBS (nothing here to tear down).
    const sessionUrl = whipSessionUrlRef.current;
    if (sessionUrl) {
      const base = new URL(SRS_WHIP_URL);
      fetch(`${base.origin}${sessionUrl}`, { method: "DELETE" }).catch(() => {});
    }
    cleanupPeer();
    cleanupMedia();
    try {
      await fetch("/api/backend/streams/end", { method: "POST" });
    } catch {
      // Proceed regardless — the local camera/peer teardown above already
      // happened, and the DB will self-correct via the reaper if this
      // request genuinely failed to land.
    }
    whipSessionUrlRef.current = null;
    setBrowserPhase("idle");
    setIsLive(false);
    setEnding(false);
  }

  async function handleBoost() {
    setBoosting(true);
    setBoostError(null);
    try {
      const res = await fetch("/api/backend/streams/boost", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to boost stream");
      const boost = boostStreamResponseSchema.parse(data);
      setBoostedUntil(boost.endsAt);
    } catch (err) {
      setBoostError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBoosting(false);
    }
  }

  // The browser tab's own "live" view already has its own End stream
  // button embedded alongside the camera preview — don't duplicate it here.
  const showTopBanner = isLive && !(method === "browser" && browserPhase === "live");

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Go live</h2>

      <div className={styles.tabs}>
        <button
          type="button"
          className={method === "obs" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setMethod("obs")}
          disabled={isLive && method !== "obs"}
        >
          OBS / streaming software
        </button>
        <button
          type="button"
          className={method === "browser" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setMethod("browser")}
          disabled={isLive && method !== "browser"}
        >
          Browser camera
        </button>
      </div>

      {showTopBanner && (
        <div className={styles.liveBanner}>
          <span className={styles.liveBadge}>Live</span>
          <button type="button" className={styles.endButton} onClick={handleEndStream} disabled={ending}>
            {ending ? "Ending…" : "End stream"}
          </button>
        </div>
      )}

      {isLive && (
        <div className={styles.boostRow}>
          {boostedUntil ? (
            <p className={styles.boostActiveText}>
              Boosted until {new Date(boostedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          ) : (
            <>
              <button type="button" className={styles.boostButton} onClick={handleBoost} disabled={boosting}>
                {boosting ? "Boosting…" : `Boost my stream — ${formatSantimAsBirr(BOOST_PRICE_SANTIM)}/hr`}
              </button>
              {boostError && <p className={styles.error}>{boostError}</p>}
            </>
          )}
        </div>
      )}

      {method === "obs" && (
        <div className={styles.tabContent}>
          <p className={styles.subtext}>
            Point OBS (or any RTMP encoder) at the server URL and key below, then click Go live.
          </p>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>RTMP server URL</span>
            <code className={styles.readonlyValue}>{rtmpUrl}</code>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Stream key</span>
            <StreamKeyRow initialStreamKey={streamKey} />
          </div>
          {!isLive && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleObsGoLive}
              disabled={obsLoading}
            >
              {obsLoading ? "Starting…" : "Go live"}
            </button>
          )}
          {obsError && <p className={styles.error}>{obsError}</p>}
        </div>
      )}

      {method === "browser" && (
        <div className={styles.tabContent}>
          <p className={styles.subtext}>
            No OBS needed — stream straight from your camera. Uses the same stream key as the RTMP setup
            above, so only one can be live at a time.
          </p>

          {isLive && browserPhase === "idle" ? (
            <p className={styles.subtext}>
              You&apos;re already live from another session. End that stream first to go live from your browser.
            </p>
          ) : (
            <>
              <div className={styles.previewWrap}>
                {browserPhase === "idle" ? (
                  <div className={styles.previewPlaceholder}>Camera off</div>
                ) : (
                  <video ref={videoRef} className={styles.preview} autoPlay playsInline muted />
                )}
                {browserPhase === "live" && <span className={styles.liveBadge}>Live</span>}
              </div>

              {browserError && <p className={styles.error}>{browserError}</p>}

              <div className={styles.actions}>
                {browserPhase === "idle" && (
                  <button type="button" className={styles.primaryButton} onClick={handleStartCamera}>
                    Start camera
                  </button>
                )}
                {browserPhase === "previewing" && (
                  <>
                    <button type="button" className={styles.primaryButton} onClick={handleBrowserGoLive}>
                      Go live
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        cleanupMedia();
                        setBrowserPhase("idle");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {browserPhase === "starting" && (
                  <button type="button" className={styles.primaryButton} disabled>
                    Working…
                  </button>
                )}
                {browserPhase === "live" && (
                  <button type="button" className={styles.endButton} onClick={handleEndStream} disabled={ending}>
                    {ending ? "Ending…" : "End stream"}
                  </button>
                )}
                {browserPhase === "error" && (
                  <button type="button" className={styles.primaryButton} onClick={handleStartCamera}>
                    Try again
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
