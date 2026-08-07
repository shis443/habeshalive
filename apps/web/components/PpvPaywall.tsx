"use client";

import { formatSantimAsBirr } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import styles from "./PpvPaywall.module.css";

// Renders in place of VideoPlayer when a stream is PPV-gated and the
// current viewer hasn't purchased access — see streams/service.ts's
// toStreamDetail (playbackUrl is already null in this case, this is
// what fills that space). Purchase charges the wallet balance
// synchronously (streams/ppv-service.ts's purchasePpvAccess) and returns
// an access token too, but the simplest way to unlock this page is just
// router.refresh(): the next server render re-resolves hasPpvAccess via
// the same session cookie, now that a real ppv_purchases row exists. The
// returned accessToken matters for the cookie-less /embed page, not this
// one — see streams/routes.ts's ?ticket= handling.
export function PpvPaywall({
  streamId,
  priceSantim,
  isAuthed,
}: {
  streamId: string;
  priceSantim: number;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePurchase() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/streams/${streamId}/ppv/purchase`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to buy access");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Ticketed broadcast</p>
        <h2 className={styles.title}>This stream requires a ticket</h2>
        <p className={styles.price}>{formatSantimAsBirr(priceSantim)}</p>
        <button type="button" className={styles.buyButton} onClick={handlePurchase} disabled={loading}>
          {loading ? "Processing…" : "Buy access"}
        </button>
        <p className={styles.hint}>Charged from your wallet balance. Top up first if you need to.</p>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
