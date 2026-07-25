"use client";

import { formatSantimAsBirr, type GiftType } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { CloseIcon } from "./icons";
import styles from "./GiftModal.module.css";

const GIFT_EMOJI: Record<string, string> = {
  buna: "☕",
  injera: "🫓",
  lion: "🦁",
  crown: "👑",
};

export function GiftModal({
  streamId,
  giftTypes,
  isAuthed,
  onClose,
}: {
  streamId: string;
  giftTypes: GiftType[];
  isAuthed: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(giftTypes[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // GiftModal is only ever mounted by its trigger (the gift button in
  // ChatPanel) while it should be visible, so `dropdown.open` here purely
  // drives useDropdown's outside-click detection — flip it on as soon as
  // this mounts, and treat it flipping back off (an outside click) the same
  // as an explicit close.
  const dropdown = useDropdown<HTMLDivElement>();
  const { setOpen } = dropdown;
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  useEffect(() => {
    if (!dropdown.open) onClose();
  }, [dropdown.open, onClose]);

  async function handleSend() {
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!selectedId) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/wallet/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, giftTypeId: selectedId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send gift");
      setSuccess(true);
      router.refresh();
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.anchor} ref={dropdown.ref}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>Send a gift</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className={styles.grid}>
          {giftTypes.map((gift) => (
            <button
              key={gift.id}
              type="button"
              className={`${styles.giftTile} ${selectedId === gift.id ? styles.giftTileSelected : ""}`}
              onClick={() => setSelectedId(gift.id)}
            >
              <span className={styles.giftEmoji}>{GIFT_EMOJI[gift.animationKey] ?? "🎁"}</span>
              <span className={styles.giftName}>{gift.name}</span>
              <span className={styles.giftPrice}>{formatSantimAsBirr(gift.priceSantim)}</span>
            </button>
          ))}
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="gift-quantity">
            Quantity
          </label>
          <input
            id="gift-quantity"
            type="number"
            min="1"
            max="999"
            className={styles.input}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>Gift sent!</p>}

        <button type="button" className={styles.sendButton} onClick={handleSend} disabled={loading || !selectedId}>
          {loading ? "Sending..." : "Send gift"}
        </button>
      </div>
    </div>
  );
}
