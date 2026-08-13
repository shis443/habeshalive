"use client";

import { formatSantimAsBirr, type DonateResponse } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import { openAuthModal } from "@/lib/useAuthModal";
import { CloseIcon } from "./icons";
import styles from "./GurshaModal.module.css";

const AMOUNT_PRESETS_SANTIM = [500, 1000, 2500, 5000, 10000];
const MIN_SANTIM = 500;

// A free-form cash tip, distinct from GurshaModal's catalog-item gifts —
// see db/migrations/0033_donations_and_ppv.sql's comment. Reuses
// GurshaModal.module.css directly rather than a new stylesheet: same
// panel/field/button visual language, no reason to duplicate it.
export function DonateModal({
  streamId,
  isAuthed,
  onClose,
}: {
  streamId: string;
  isAuthed: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(AMOUNT_PRESETS_SANTIM[1]!);
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<DonateResponse | null>(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  async function handleSend() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/wallet/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId,
          amountSantim: amount,
          message: message.trim() || undefined,
          isAnonymous,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send donation");
      }
      const data = await unwrapClientData<DonateResponse>(res);
      setSuccess(data);
      router.refresh();
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>Send a Donation</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
          Send Anonymously
        </label>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Amount</label>
          <div className={styles.tierRow}>
            {AMOUNT_PRESETS_SANTIM.map((preset) => (
              <button
                key={preset}
                type="button"
                className={amount === preset && !customAmount ? styles.tierButtonActive : styles.tierButton}
                onClick={() => {
                  setAmount(preset);
                  setCustomAmount("");
                }}
              >
                {formatSantimAsBirr(preset)}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={MIN_SANTIM / 100}
            className={styles.input}
            placeholder={`Custom amount (min ${formatSantimAsBirr(MIN_SANTIM)})`}
            value={customAmount}
            onChange={(e) => {
              const raw = e.target.value;
              setCustomAmount(raw);
              const etb = Math.max(MIN_SANTIM / 100, Number(raw) || 0);
              setAmount(Math.round(etb * 100));
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="donation-message">
            Message (optional)
          </label>
          <input
            id="donation-message"
            type="text"
            maxLength={200}
            className={styles.input}
            placeholder="Say something..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <p className={styles.total}>Total: {formatSantimAsBirr(amount)}</p>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>Donation sent!</p>}

        <button type="button" className={styles.sendButton} onClick={handleSend} disabled={loading}>
          {loading ? "Sending..." : "Send Donation"}
        </button>
      </div>
    </div>
  );
}
