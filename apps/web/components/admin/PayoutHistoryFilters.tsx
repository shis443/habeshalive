"use client";

import { useRouter, useSearchParams } from "next/navigation";
import styles from "./PayoutHistoryFilters.module.css";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "pending_review", label: "Pending review" },
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed / rejected" },
];

export function PayoutHistoryFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/admin/payouts?${params.toString()}`);
  }

  return (
    <div className={styles.filters}>
      <select
        className={styles.select}
        value={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        className={styles.input}
        placeholder="Filter by creator username"
        defaultValue={searchParams.get("creator") ?? ""}
        onBlur={(e) => updateParam("creator", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") updateParam("creator", e.currentTarget.value);
        }}
      />
    </div>
  );
}
