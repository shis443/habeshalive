"use client";

import { birrToSantim, type GiftCardDeliveryMethod, type GiftCardDesignTheme } from "@birq/shared";
import { useState } from "react";
import styles from "./GiftCardPurchaseForm.module.css";

// Real illustrated card art per occasion isn't available yet (same
// art-blocked-not-code-blocked situation as Gursha's mulmul themes) — one
// distinct color per occasion, swappable for real assets later.
const THEMES: { value: GiftCardDesignTheme; label: string; color: string }[] = [
  { value: "enkutatash", label: "Enkutatash (New Year)", color: "#f4c430" },
  { value: "genna", label: "Genna (Christmas)", color: "#b71c1c" },
  { value: "timket", label: "Timket", color: "#1565c0" },
  { value: "fasika", label: "Fasika (Easter)", color: "#7b1fa2" },
  { value: "meskel", label: "Meskel", color: "#f57c00" },
  { value: "birthday", label: "Birthday", color: "#e91e8c" },
  { value: "wedding", label: "Wedding", color: "#c9a227" },
  { value: "graduation", label: "Graduation", color: "#2e7d32" },
  { value: "generic_celebration", label: "Celebration", color: "#00897b" },
];

const AMOUNT_TIERS = [50, 100, 250, 500];

export function GiftCardPurchaseForm() {
  const [amountBirr, setAmountBirr] = useState("100");
  const [customAmount, setCustomAmount] = useState("");
  const [theme, setTheme] = useState<GiftCardDesignTheme>("generic_celebration");
  const [personalMessage, setPersonalMessage] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<GiftCardDeliveryMethod>("link");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; redemptionUrl: string } | null>(null);

  const effectiveAmount = customAmount || amountBirr;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountSantim: birrToSantim(parseFloat(effectiveAmount || "0")),
          designTheme: theme,
          personalMessage: personalMessage || undefined,
          deliveryMethod,
          recipientEmail: deliveryMethod === "email" ? recipientEmail : undefined,
          recipientPhone: deliveryMethod === "sms" ? recipientPhone : undefined,
          scheduledDeliveryAt: scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to purchase gift card");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className={styles.result}>
        <p>Gift card created.</p>
        {deliveryMethod === "link" ? (
          <>
            <p>Share this link with the recipient:</p>
            <input readOnly className={styles.input} value={result.redemptionUrl} onClick={(e) => e.currentTarget.select()} />
          </>
        ) : (
          <p>Delivery is on its way to the recipient. Code: {result.code}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <label className={styles.fieldLabel}>Amount (ETB)</label>
      <div className={styles.tierRow}>
        {AMOUNT_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            className={amountBirr === String(tier) && !customAmount ? styles.tierButtonActive : styles.tierButton}
            onClick={() => {
              setAmountBirr(String(tier));
              setCustomAmount("");
            }}
          >
            {tier} ETB
          </button>
        ))}
      </div>
      <input
        type="number"
        min="1"
        className={styles.input}
        placeholder="Custom amount (ETB)"
        value={customAmount}
        onChange={(e) => setCustomAmount(e.target.value)}
      />

      <label className={styles.fieldLabel}>Design</label>
      <div className={styles.themeGrid}>
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={theme === t.value ? styles.themeTileSelected : styles.themeTile}
            style={{ borderColor: theme === t.value ? t.color : undefined, background: `${t.color}22` }}
            onClick={() => setTheme(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className={styles.fieldLabel}>Personal message (optional)</label>
      <textarea
        className={styles.input}
        rows={3}
        maxLength={300}
        value={personalMessage}
        onChange={(e) => setPersonalMessage(e.target.value)}
      />

      <label className={styles.fieldLabel}>Delivery</label>
      <div className={styles.tierRow}>
        {(["link", "email", "sms"] as GiftCardDeliveryMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            className={deliveryMethod === m ? styles.tierButtonActive : styles.tierButton}
            onClick={() => setDeliveryMethod(m)}
          >
            {m === "link" ? "Shareable link" : m === "email" ? "Email" : "SMS"}
          </button>
        ))}
      </div>
      {deliveryMethod === "email" && (
        <input
          type="email"
          className={styles.input}
          placeholder="Recipient email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      )}
      {deliveryMethod === "sms" && (
        <input
          type="text"
          className={styles.input}
          placeholder="Recipient phone (+251...)"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
        />
      )}

      <label className={styles.fieldLabel}>Schedule delivery for later (optional)</label>
      <input type="date" className={styles.input} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />

      <button
        type="button"
        className={styles.submitButton}
        disabled={
          submitting ||
          !effectiveAmount ||
          (deliveryMethod === "email" && !recipientEmail) ||
          (deliveryMethod === "sms" && !recipientPhone)
        }
        onClick={submit}
      >
        {submitting ? "Processing..." : "Buy gift card"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
