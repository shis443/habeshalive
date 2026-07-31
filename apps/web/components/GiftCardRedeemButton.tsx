"use client";

import { formatSantimAsBirr } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./GiftCardPurchaseForm.module.css";

export function GiftCardRedeemButton({ code, isAuthed, amountSantim }: { code: string; isAuthed: boolean; amountSantim: number }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);

  async function redeem() {
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/gift-cards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to redeem");
      setRedeemed(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (redeemed) {
    return <p className={styles.result}>{formatSantimAsBirr(amountSantim)} added to your Birq wallet.</p>;
  }

  return (
    <div>
      <button type="button" className={styles.submitButton} disabled={submitting} onClick={redeem}>
        {submitting ? "Redeeming..." : isAuthed ? "Redeem to my wallet" : "Log in to redeem"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
