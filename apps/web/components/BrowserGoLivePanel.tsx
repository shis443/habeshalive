"use client";

import { streamDetailSchema } from "@habeshalive/shared";
import { useEffect, useRef, useState } from "react";
import { SRS_WEBRTC_PUBLIC_IP, SRS_WHIP_URL } from "@/lib/config";
import styles from "./BrowserGoLivePanel.module.css";

type Phase = "idle" | "previewing" | "starting" | "live" | "error";

function buildWhipUrl(streamKey: string): string {
  const url = new URL(SRS_WHIP_URL);
  url.searchParams.set("app", "live");
  url.searchParams.set("stream", streamKey);
  // Must be a real IP literal, not the WHIP host's hostname — see
  // SRS_WEBRTC_PUBLIC_IP's own comment in lib/config.ts for why.
  url.searchParams.set("eip", SRS_WEBRTC_PUBLIC_IP);
  return url.toString();
}

export function BrowserGoLivePanel({ streamKey, displayName }: { streamKey: string; displayName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const whipSessionUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

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

  function cleanupMedia() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function cleanupPeer() {
    peerRef.current?.close();
    peerRef.current = null;
  }

  async function handleStartCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPhase("previewing");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera/microphone access was denied — allow it in your browser's site settings to go live this way."
          : "Couldn't access your camera/microphone."
      );
      setPhase("error");
    }
  }

  async function handleGoLive() {
    const mediaStream = mediaStreamRef.current;
    if (!mediaStream) return;
    setError(null);
    setPhase("starting");
    try {
      // Same title-setting step the OBS-based flow's "Go live" button does —
      // WHIP publishing below would also mark the stream live on its own
      // (via SRS's on_publish webhook, same as RTMP), but only this call
      // sets a proper title instead of the generic webhook-only fallback.
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
      // instead of declaring victory right after setRemoteDescription.
      const connected = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out connecting to the stream server")), 15000);
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
      setPhase("live");

      // If the connection drops later (network blip, ICE renegotiation
      // failure), reflect that instead of leaving a stale "Live" badge up.
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          cleanupPeer();
          cleanupMedia();
          setError("Lost connection to the stream server.");
          setPhase("error");
        }
      });
    } catch (err) {
      cleanupPeer();
      setError(err instanceof Error ? err.message : "Failed to go live");
      setPhase("error");
    }
  }

  async function handleEndStream() {
    setPhase("starting");
    // Best-effort WHIP teardown (tells SRS to close the session
    // immediately instead of waiting for the connection to time out) — not
    // awaited-and-thrown-on-failure, since the DB-side end-stream call
    // below is what actually matters for the rest of the app.
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
      // Same reasoning as GoLiveButton/TopNav's logout — proceed regardless,
      // the local camera/peer teardown above already happened.
    }
    whipSessionUrlRef.current = null;
    setPhase("idle");
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Go live from your browser</h2>
      <p className={styles.subtext}>
        No OBS needed — stream straight from your camera. Uses the same stream key as the RTMP setup
        above, so only one can be live at a time.
      </p>

      <div className={styles.previewWrap}>
        {phase === "idle" ? (
          <div className={styles.previewPlaceholder}>Camera off</div>
        ) : (
          <video ref={videoRef} className={styles.preview} autoPlay playsInline muted />
        )}
        {phase === "live" && <span className={styles.liveBadge}>Live</span>}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        {phase === "idle" && (
          <button type="button" className={styles.primaryButton} onClick={handleStartCamera}>
            Start camera
          </button>
        )}
        {phase === "previewing" && (
          <>
            <button type="button" className={styles.primaryButton} onClick={handleGoLive}>
              Go live
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                cleanupMedia();
                setPhase("idle");
              }}
            >
              Cancel
            </button>
          </>
        )}
        {phase === "starting" && (
          <button type="button" className={styles.primaryButton} disabled>
            Working…
          </button>
        )}
        {phase === "live" && (
          <button type="button" className={styles.endButton} onClick={handleEndStream}>
            End stream
          </button>
        )}
        {phase === "error" && (
          <button type="button" className={styles.primaryButton} onClick={handleStartCamera}>
            Try again
          </button>
        )}
      </div>
    </section>
  );
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
