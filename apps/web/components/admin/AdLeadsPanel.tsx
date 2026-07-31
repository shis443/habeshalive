"use client";

import type { AdLeadAdminItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import styles from "./AdminQueue.module.css";

const STATUSES = ["new", "contacted", "closed"] as const;

export function AdLeadsPanel({ leads }: { leads: AdLeadAdminItem[] }) {
  const router = useRouter();

  async function setStatus(id: string, status: string) {
    await fetch(`/api/backend/admin/ad-leads/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  if (leads.length === 0) return <p className={styles.empty}>No advertiser inquiries yet.</p>;

  return (
    <div className={styles.list}>
      {leads.map((lead) => (
        <div key={lead.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>
              {lead.companyName} — {lead.contactName}
            </span>
            <span className={styles.rowMeta}>{lead.contactEmail}</span>
            {lead.message && <span className={styles.rowDetail}>&ldquo;{lead.message}&rdquo;</span>}
          </div>
          <div className={styles.actions}>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={lead.status === s ? styles.approveButton : styles.denyButton}
                onClick={() => setStatus(lead.id, s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
