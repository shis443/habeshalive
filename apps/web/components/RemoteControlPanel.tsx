"use client";

import { useState } from "react";
import { useRemoteStreamControl } from "@/hooks/useRemoteStreamControl";
import styles from "./RemoteControlPanel.module.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  authenticating: "Authenticating…",
  connected: "Connected",
  wrongPassword: "Wrong remote control PIN",
  forbidden: "You don't have access to control this stream",
  disconnected: "Disconnected",
};

// Control hub for a creator's own broadcast — see useRemoteStreamControl's
// own comment for the two-credential design (a ticket scopes this browser
// to Birq; the PIN below still authenticates it to the phone itself,
// unchanged from the existing Swift protocol). streamerId is always the
// signed-in creator's own id: this panel only ever requests an "owner"
// scoped ticket for the account it's rendered under — a delegated
// assistant reaches the same stream by being granted access (creator
// settings), not by typing someone else's id in here.
export function RemoteControlPanel({ streamerId }: { streamerId: string }) {
  const rc = useRemoteStreamControl();
  const [password, setPassword] = useState("");

  const connected = rc.status === "connected";
  const busy = rc.status === "connecting" || rc.status === "authenticating";

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    void rc.connect(streamerId, password);
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Remote Control</h2>

      {!connected && (
        <form className={styles.connectRow} onSubmit={handleConnect}>
          <input
            type="password"
            className={styles.pinInput}
            placeholder="Remote control PIN"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-label="Remote control PIN"
          />
          <button type="submit" className={styles.connectButton} disabled={busy || !password}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}

      <p className={`${styles.status} ${connected ? styles.statusConnected : ""}`}>
        <span className={styles.statusDot} />
        {STATUS_LABEL[rc.status] ?? rc.status}
      </p>

      {connected && (
        <>
          <div className={styles.previewRow}>
            {rc.previewDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rc.previewDataUrl} alt="Live preview" className={styles.preview} />
            ) : (
              <div className={styles.previewPlaceholder}>No preview yet</div>
            )}
            <div className={styles.telemetry}>
              <div className={styles.telemetryRow}>
                <span>Battery</span>
                <span>{rc.general?.batteryLevel != null ? `${rc.general.batteryLevel}%` : "—"}</span>
              </div>
              <div className={styles.telemetryRow}>
                <span>Wi-Fi</span>
                <span>{rc.general?.wiFiSsid ?? "—"}</span>
              </div>
              <div className={styles.telemetryRow}>
                <span>Bitrate</span>
                <span>{rc.topRight?.bitrate?.message ?? "—"}</span>
              </div>
              <div className={styles.telemetryRow}>
                <span>Uptime</span>
                <span>{rc.topRight?.uptime?.message ?? "—"}</span>
              </div>
              <div className={styles.telemetryRow}>
                <span>SRTLA</span>
                <span>{rc.topRight?.srtla?.message ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className={styles.controlsRow}>
            <button
              type="button"
              className={rc.general?.isLive ? styles.dangerButtonActive : styles.dangerButton}
              onClick={() => void rc.setLive(!rc.general?.isLive)}
            >
              {rc.general?.isLive ? "End stream" : "Go live"}
            </button>
            <button
              type="button"
              className={rc.general?.isRecording ? styles.controlButtonActive : styles.controlButton}
              onClick={() => void rc.setRecord(!rc.general?.isRecording)}
            >
              {rc.general?.isRecording ? "Stop recording" : "Start recording"}
            </button>
            <button
              type="button"
              className={rc.general?.isMuted ? styles.controlButtonActive : styles.controlButton}
              onClick={() => void rc.setMute(!rc.general?.isMuted)}
            >
              {rc.general?.isMuted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className={styles.controlButton} onClick={() => void rc.setTorch(true)}>
              Torch
            </button>
          </div>

          {rc.settings && rc.settings.scenes.length > 0 && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Scene</label>
              <div className={styles.pillRow}>
                {rc.settings.scenes.map((scene) => (
                  <button
                    key={scene.id}
                    type="button"
                    className={rc.currentSceneId === scene.id ? styles.pillActive : styles.pill}
                    onClick={() => void rc.setScene(scene.id)}
                  >
                    {scene.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rc.settings && rc.settings.mics.length > 0 && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Microphone</label>
              <div className={styles.pillRow}>
                {rc.settings.mics.map((mic) => (
                  <button
                    key={mic.id}
                    type="button"
                    className={rc.currentMicId === mic.id ? styles.pillActive : styles.pill}
                    onClick={() => void rc.setMic(mic.id)}
                  >
                    {mic.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rc.settings && rc.settings.bitratePresets.length > 0 && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Bitrate preset</label>
              <div className={styles.pillRow}>
                {rc.settings.bitratePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={styles.pill}
                    onClick={() => void rc.setBitratePreset(preset.id)}
                  >
                    {preset.bitrate.toLocaleString()} kbps
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" className={styles.disconnectButton} onClick={rc.disconnect}>
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}
