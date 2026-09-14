"use client";

import { birrToSantim, santimToBirr, PLATFORM_SUBSCRIPTION_MIN_SANTIM, type PlatformSubscription } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import styles from "./BirqPlusSubscribeForm.module.css";

const PRESETS_BIRR = [150, 250, 500, 1000];

export function BirqPlusSubscribeForm({
  isAuthed,
  initial,
}: {
  isAuthed: boolean;
  initial: PlatformSubscription | null;
}) {
  const router = useRouter();
  const [sub, setSub] = useState(initial);
  const [amountBirr, setAmountBirr] = useState(String(santimToBirr(PLATFORM_SUBSCRIPTION_MIN_SANTIM)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(e: FormEvent) {
    e.preventDefault();
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/subscriptions/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountSantim: birrToSantim(parseFloat(amountBirr || "0")) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start subscription");
      setSub(data.data as PlatformSubscription);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel Birq Plus? You'll keep your perks until the current period ends.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/subscriptions/platform", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel");
      setSub((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      router.refresh();
    } catch {
      setError("Failed to cancel");
    } finally {
      setBusy(false);
    }
  }

  if (sub && sub.status === "active") {
    return (
      <div className={styles.card}>
        <p className={styles.activeLine}>
          You&apos;re a Birq Plus subscriber at {santimToBirr(sub.amountSantim)} ETB/month.
        </p>
        <p className={styles.hint}>Renews {new Date(sub.expiresAt).toLocaleDateString()}.</p>
        <button type="button" className={styles.cancelButton} onClick={cancel} disabled={busy}>
          Cancel subscription
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <form className={styles.card} onSubmit={subscribe}>
      <p className={styles.label}>Choose your monthly amount</p>
      <div className={styles.presets}>
        {PRESETS_BIRR.map((birr) => (
          <button
            key={birr}
            type="button"
            className={String(birr) === amountBirr ? styles.presetActive : styles.preset}
            onClick={() => setAmountBirr(String(birr))}
          >
            {birr} ETB
          </button>
        ))}
      </div>
      <label className={styles.customLabel} htmlFor="birq-plus-amount">
        Or enter a custom amount (min {santimToBirr(PLATFORM_SUBSCRIPTION_MIN_SANTIM)} ETB)
      </label>
      <input
        id="birq-plus-amount"
        type="number"
        min={santimToBirr(PLATFORM_SUBSCRIPTION_MIN_SANTIM)}
        step="1"
        className={styles.input}
        value={amountBirr}
        onChange={(e) => setAmountBirr(e.target.value)}
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.subscribeButton} disabled={busy}>
        {busy ? "Starting…" : `Subscribe for ${amountBirr || 0} ETB/month`}
      </button>
    </form>
  );
}
