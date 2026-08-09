"use client";

import { formatSantimAsBirr, subscribeResponseSchema, type SubscriptionTier } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { openAuthModal } from "@/lib/useAuthModal";
import { ChevronRightIcon } from "./icons";
import styles from "./TierActionDropdown.module.css";

export function TierActionDropdown({
  label,
  tiers,
  creatorId,
  isAuthed,
  mode,
  secondary = false,
}: {
  label: string;
  tiers: SubscriptionTier[];
  creatorId: string;
  isAuthed: boolean;
  mode: "subscribe" | "gift-sub-stub";
  secondary?: boolean;
}) {
  const router = useRouter();
  const dropdown = useDropdown<HTMLDivElement>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function handleSelectTier(tierId: string) {
    if (!isAuthed) {
      openAuthModal();
      return;
    }

    if (mode === "gift-sub-stub") {
      // Gifting a sub to a specific viewer needs a recipient picker, which
      // isn't built — be honest about that instead of faking the action.
      setMessage({ text: "Gifting subs to other viewers isn't wired up yet.", isError: false });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backend/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId, tierId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to subscribe");
      const sub = subscribeResponseSchema.parse(data);
      setMessage({ text: `Subscribed (${sub.tierName})!`, isError: false });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", isError: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={`${styles.trigger} ${secondary ? styles.triggerSecondary : ""}`}
        onClick={() => dropdown.setOpen((o) => !o)}
      >
        {label}
        <ChevronRightIcon />
      </button>
      {dropdown.open && (
        <div className={styles.dropdown}>
          {mode === "subscribe" && <p className={styles.perk}>No ads on this creator&apos;s stream while subscribed.</p>}
          {tiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className={styles.tierButton}
              disabled={loading}
              onClick={() => handleSelectTier(tier.id)}
            >
              <span>{tier.name}</span>
              <span className={styles.tierPrice}>{formatSantimAsBirr(tier.priceSantim)}</span>
            </button>
          ))}
          {message && (
            <p className={`${styles.message} ${message.isError ? styles.messageError : ""}`}>
              {message.text}
            </p>
          )}
          {mode === "subscribe" && (
            <button
              type="button"
              className={styles.backToGursha}
              onClick={() => {
                dropdown.setOpen(false);
                const target = document.querySelector<HTMLButtonElement>('[aria-label="Send Gursha"]');
                target?.scrollIntoView({ behavior: "smooth", block: "center" });
                target?.click();
              }}
            >
              Send Gursha instead →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
