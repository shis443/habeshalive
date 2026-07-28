"use client";

import { useRouter, useSearchParams } from "next/navigation";
import filterStyles from "./PayoutHistoryFilters.module.css";
import styles from "./AdminQueue.module.css";

const ACTION_DOMAINS = [
  { value: "", label: "All actions" },
  { value: "payout", label: "Payouts" },
  { value: "creator", label: "Creators" },
  { value: "user", label: "Users" },
  { value: "boost", label: "Boosts" },
  { value: "subscription", label: "Subscriptions" },
  { value: "config", label: "Settings" },
  { value: "ledger", label: "Ledger" },
  { value: "stream", label: "Streams" },
  { value: "blocklist", label: "Blocklist" },
];

const DEFAULT_LIMIT = 100;

export function AuditLogFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key === "action") params.delete("limit");
    router.push(`/admin/audit-log?${params.toString()}`);
  }

  function loadMore() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", String(Math.min(limit + DEFAULT_LIMIT, 500)));
    router.push(`/admin/audit-log?${params.toString()}`);
  }

  return (
    <div className={filterStyles.filters}>
      <select
        className={filterStyles.select}
        value={searchParams.get("action") ?? ""}
        onChange={(e) => updateParam("action", e.target.value)}
      >
        {ACTION_DOMAINS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      {limit < 500 && (
        <button type="button" className={styles.denyButton} onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
