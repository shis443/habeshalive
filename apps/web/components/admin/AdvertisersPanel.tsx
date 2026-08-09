"use client";

import type { Advertiser } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

export function AdvertisersPanel({ advertisers }: { advertisers: Advertiser[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/advertisers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactEmail: email || undefined, contactPhone: phone || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create advertiser");
      setName("");
      setEmail("");
      setPhone("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={formStyles.form}>
        <div className={formStyles.row}>
          <input className={filterStyles.input} placeholder="Advertiser name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={filterStyles.input} placeholder="Contact email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={filterStyles.input} placeholder="Contact phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button type="button" className={styles.approveButton} disabled={submitting || !name} onClick={submit}>
          Add advertiser
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.list}>
        {advertisers.map((adv) => (
          <div key={adv.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>{adv.name}</span>
              <span className={styles.rowMeta}>
                {adv.contactEmail ?? "no email"} · {adv.contactPhone ?? "no phone"} · {adv.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
