"use client";

import { formatSantimAsBirr, type LedgerTransactionLookup } from "@birq/shared";
import { useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";

export function LedgerLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LedgerTransactionLookup[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/admin/ledger/lookup?q=${encodeURIComponent(query.trim())}`);
      setResults(res.ok ? await unwrapClientData<LedgerTransactionLookup[]>(res) : []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className={filterStyles.filters}>
        <input
          type="text"
          className={filterStyles.input}
          placeholder="Transaction reference or id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
        />
        <button type="button" className={styles.approveButton} onClick={search} disabled={loading || !query.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {results !== null && (
        <div className={styles.list}>
          {results.length === 0 ? (
            <p className={styles.empty}>No transaction matches that reference or id.</p>
          ) : (
            results.map((tx) => (
              <div key={tx.id} className={styles.rowStack}>
                <div className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {tx.type} — {tx.status}
                    </span>
                    <span className={styles.rowMeta}>
                      {tx.id} {tx.reference ? `· ref: ${tx.reference}` : ""}
                    </span>
                  </div>
                </div>
                {tx.entries.map((entry) => (
                  <div key={entry.id} className={styles.rowMeta}>
                    {entry.direction} {formatSantimAsBirr(entry.amountSantim)} —{" "}
                    {entry.walletOwnerType === "platform" ? "platform wallet" : `@${entry.walletOwnerUsername}`}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
