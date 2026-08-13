"use client";

import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./AccountSection.module.css";

type Step = "idle" | "setup" | "confirm" | "enabled" | "disable";

// Renders the otpauth:// URI as a scannable QR (qrcode-generator: a
// zero-dependency pure-JS encoder, no network round-trip to a third-party
// QR image service — a real secret has no business leaving this page to
// get turned into an image). Type 0 = automatic version selection for
// whatever the otpauth URI's length needs.
function useQrSvg(otpauthUri: string): string {
  return useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(otpauthUri);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2 });
  }, [otpauthUri]);
}

export function TotpSection({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrSvg = useQrSvg(otpauthUri);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/2fa/setup", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start setup");
      }
      const data = await unwrapClientData<{ secret: string; otpauthUri: string }>(res);
      setSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
      setStep("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      setEnabled(true);
      setStep("idle");
      setCode("");
      setSecret("");
      setOtpauthUri("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      setEnabled(false);
      setStep("idle");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setStep("idle");
    setCode("");
    setSecret("");
    setOtpauthUri("");
    setError(null);
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Two-factor authentication</h2>

      {step === "idle" && enabled && (
        <>
          <p className={styles.currentValue}>Enabled — a code from your authenticator app is required at login.</p>
          <button type="button" className={styles.buttonDanger} onClick={() => setStep("disable")}>
            Disable 2FA
          </button>
        </>
      )}

      {step === "idle" && !enabled && (
        <>
          <p className={styles.hint}>
            Add a second step at login using an authenticator app (Google Authenticator, Authy, etc.) —
            a stolen password alone won&apos;t be enough to sign in.
          </p>
          <button type="button" className={styles.button} onClick={startSetup} disabled={busy}>
            {busy ? "Starting…" : "Enable 2FA"}
          </button>
        </>
      )}

      {step === "setup" && (
        <>
          <p className={styles.hint}>Scan this with your authenticator app, or enter the key manually:</p>
          <div
            style={{ width: 176, background: "#fff", padding: 12, borderRadius: 8, margin: "8px 0" }}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p className={styles.currentValue} style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            {secret}
          </p>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="totp-setup-code">
              Enter the 6-digit code it shows
            </label>
            <input
              id="totp-setup-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              onClick={confirmSetup}
              disabled={busy || code.length !== 6}
            >
              {busy ? "Confirming…" : "Confirm & enable"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step === "disable" && (
        <>
          <p className={styles.hint}>Enter a current code from your authenticator app to disable 2FA.</p>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="totp-disable-code">
              6-digit code
            </label>
            <input
              id="totp-disable-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.buttonDanger}
              onClick={disable}
              disabled={busy || code.length !== 6}
            >
              {busy ? "Disabling…" : "Confirm disable"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
