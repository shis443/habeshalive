"use client";

import {
  STREAM_CATEGORIES,
  STREAM_LANGUAGES,
  birrToSantim,
  boostStreamResponseSchema,
  formatSantimAsBirr,
  streamDefaultsSchema,
  streamDetailSchema,
} from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import { SRS_WHIP_URL } from "@/lib/config";
import { SquadPanel } from "./SquadPanel";
import { StreamKeyRow } from "./StreamKeyRow";
import { StreamTagsInput } from "./StreamTagsInput";
import styles from "./GoLivePanel.module.css";

type Method = "obs" | "browser";
type BrowserPhase = "idle" | "previewing" | "starting" | "live" | "error";

const MAX_THUMBNAIL_DIMENSION = 640;

// Resizes/compresses in the browser and returns a data: URI — see
// createStreamSchema's comment for why this is fine to send as
// thumbnailUrl directly: no object storage is wired up yet (Section 4),
// and a compressed JPEG this size is small enough to just store inline.
function fileToCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_THUMBNAIL_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process that image"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image file"));
    };
    img.src = objectUrl;
  });
}

// streamKeyField is the composed "{userId}?key={secret}" string (see
// apps/api/src/streams/service.ts's composeStreamKeyField) — same value
// shown/copied in the OBS tab's Stream Key field, since OBS just
// concatenates server + "/" + that string into one RTMP URL and SRS parses
// the "?key=" part back out as a query param on its own. WHIP already
// speaks in URL query params directly, so it's split apart here instead.
function buildWhipUrl(streamKeyField: string): string {
  const [publicStreamId, key] = streamKeyField.split("?key=");
  const url = new URL(SRS_WHIP_URL);
  url.searchParams.set("app", "live");
  url.searchParams.set("stream", publicStreamId ?? streamKeyField);
  if (key) url.searchParams.set("key", key);
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
  // Fetched, not the shared constant — admins can change the real price
  // via Settings, and a stale hardcoded number here would show a price
  // that's no longer what actually gets charged.
  const [boostPriceSantim, setBoostPriceSantim] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/backend/streams/boost-price")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setBoostPriceSantim(data.priceSantim);
      })
      .catch(() => {
        // Boost button just shows a generic label without a price if this
        // fails — not fatal, the price actually charged is still correct
        // either way since that's resolved server-side at purchase time.
      });
  }, []);

  // Setup must happen before the stream key does anything (OBS connecting,
  // WHIP publishing) — isLive already true on mount (e.g. a page refresh
  // mid-stream) skips straight past it, since there's nothing left to set
  // up for a stream that's already running.
  const [setupDone, setSetupDone] = useState(initialIsLive);
  const [setupTitle, setSetupTitle] = useState(`${displayName} is live`);
  const [setupCategory, setSetupCategory] = useState("");
  const [setupLanguage, setSetupLanguage] = useState("");
  const [setupThumbnail, setSetupThumbnail] = useState<string | null>(null);
  const [thumbnailProcessing, setThumbnailProcessing] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [setupIsSensitive, setSetupIsSensitive] = useState(false);
  const [setupCopyrightCertified, setSetupCopyrightCertified] = useState(false);
  const [setupTags, setSetupTags] = useState<string[]>([]);
  // Module 2 — per-broadcast PPV pricing (ETB, converted to santim at
  // submit time). Empty string means "not ticketed," same free-form-input
  // convention as the amount fields in DonateModal/GurshaModal.
  const [setupPpvPriceEtb, setSetupPpvPriceEtb] = useState("");

  useEffect(() => {
    if (initialIsLive) return;
    fetch("/api/backend/streams/defaults")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const defaults = streamDefaultsSchema.parse(data);
        if (defaults.category) setSetupCategory(defaults.category);
        if (defaults.language) setSetupLanguage(defaults.language);
      })
      .catch(() => {
        // Prefill is a convenience, not a requirement — the form still
        // works with blank category/language if this fails.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbnailError(null);
    setThumbnailProcessing(true);
    try {
      setSetupThumbnail(await fileToCompressedDataUrl(file));
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : "Couldn't process that image");
    } finally {
      setThumbnailProcessing(false);
    }
  }

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
        body: JSON.stringify({
          title: setupTitle,
          category: setupCategory,
          language: setupLanguage,
          thumbnailUrl: setupThumbnail ?? undefined,
          isSensitive: setupIsSensitive,
          tags: setupTags.length > 0 ? setupTags : undefined,
          ppvPriceSantim: setupPpvPriceEtb ? birrToSantim(parseFloat(setupPpvPriceEtb)) : undefined,
          copyrightCertified: setupCopyrightCertified,
        }),
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
        body: JSON.stringify({
          title: setupTitle,
          category: setupCategory,
          language: setupLanguage,
          thumbnailUrl: setupThumbnail ?? undefined,
          isSensitive: setupIsSensitive,
          tags: setupTags.length > 0 ? setupTags : undefined,
          ppvPriceSantim: setupPpvPriceEtb ? birrToSantim(parseFloat(setupPpvPriceEtb)) : undefined,
          copyrightCertified: setupCopyrightCertified,
        }),
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

  // Setup happens before the stream key does anything — OBS/browser tabs,
  // the RTMP key, all of it stay hidden until title/category/language are
  // actually filled in.
  if (!setupDone) {
    const canContinue =
      setupTitle.trim().length > 0 && setupCategory.length > 0 && setupLanguage.length > 0 && setupCopyrightCertified;
    return (
      <section className={styles.panel}>
        <h2 className={styles.heading}>Go live</h2>
        <div className={styles.tabContent}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="setup-title">
              Title
            </label>
            <input
              id="setup-title"
              type="text"
              className={styles.textInput}
              value={setupTitle}
              onChange={(e) => setSetupTitle(e.target.value)}
              maxLength={140}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="setup-category">
              Category
            </label>
            <select
              id="setup-category"
              className={styles.select}
              value={setupCategory}
              onChange={(e) => setSetupCategory(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a category
              </option>
              {STREAM_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="setup-language">
              Language
            </label>
            <select
              id="setup-language"
              className={styles.select}
              value={setupLanguage}
              onChange={(e) => setSetupLanguage(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a language
              </option>
              {STREAM_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Tags (optional, up to 5)</span>
            <StreamTagsInput tags={setupTags} onChange={setSetupTags} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="setup-ppv-price">
              Ticket price (optional — leave blank for a free stream)
            </label>
            <input
              id="setup-ppv-price"
              type="number"
              min="1"
              step="0.5"
              className={styles.textInput}
              placeholder="Price in ETB, e.g. 25"
              value={setupPpvPriceEtb}
              onChange={(e) => setSetupPpvPriceEtb(e.target.value)}
            />
            {setupPpvPriceEtb && (
              <p className={styles.subtext}>
                Viewers pay {formatSantimAsBirr(birrToSantim(parseFloat(setupPpvPriceEtb) || 0))} from their wallet
                balance to unlock this stream.
              </p>
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Thumbnail (optional)</span>
            {setupThumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={setupThumbnail} alt="" className={styles.thumbnailPreview} />
            ) : (
              <p className={styles.subtext}>
                Skip this and a placeholder is generated from your category once you go live.
              </p>
            )}
            <input type="file" accept="image/*" onChange={handleThumbnailChange} disabled={thumbnailProcessing} />
            {thumbnailProcessing && <p className={styles.subtext}>Processing image…</p>}
            {thumbnailError && <p className={styles.error}>{thumbnailError}</p>}
          </div>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={setupIsSensitive}
              onChange={(e) => setSetupIsSensitive(e.target.checked)}
            />
            Mark as sensitive/mature content
          </label>
          {setupIsSensitive && (
            <p className={styles.subtext}>
              Only viewers who&apos;ve turned on &quot;Show sensitive/mature content&quot; in
              Settings will see this stream in browse/search.
            </p>
          )}
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={setupCopyrightCertified}
              onChange={(e) => setSetupCopyrightCertified(e.target.checked)}
            />
            I certify that my broadcast does not contain copyrighted background music or other
            content I don&apos;t have the rights to use without authorization.
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setSetupDone(true)}
            disabled={!canContinue}
          >
            Continue
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Go live</h2>

      {!isLive && (
        <div className={styles.setupSummary}>
          <span>
            {setupTitle} · {setupCategory} · {setupLanguage}
          </span>
          <button type="button" className={styles.editLink} onClick={() => setSetupDone(false)}>
            Edit details
          </button>
        </div>
      )}

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
                {boosting
                  ? "Boosting…"
                  : `Boost my stream${boostPriceSantim !== null ? ` — ${formatSantimAsBirr(boostPriceSantim)}/hr` : ""}`}
              </button>
              {boostError && <p className={styles.error}>{boostError}</p>}
            </>
          )}
        </div>
      )}

      {isLive && <SquadPanel />}

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
