"use client";

import { formatSantimAsBirr, type UserListItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import userStyles from "./UsersList.module.css";

const ROLES = ["viewer", "creator", "moderator", "admin"] as const;

export function UsersList({ items }: { items: UserListItem[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(id: string, role: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update role");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleBan(item: UserListItem) {
    setSavingId(item.id);
    setError(null);
    try {
      const endpoint = item.isBanned ? "unban" : "ban";
      const reason = item.isBanned ? undefined : window.prompt("Ban reason (required):") ?? undefined;
      if (!item.isBanned && !reason) {
        setSavingId(null);
        return;
      }
      const res = await fetch(`/api/backend/moderation/actions/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: item.id, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${endpoint}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No users match this search.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                @{item.username} {item.isBanned && <span className={userStyles.bannedBadge}>Banned</span>}
              </span>
              <span className={styles.rowMeta}>
                {item.phoneNumber ?? item.email ?? "no contact"} · {formatSantimAsBirr(item.walletBalanceSantim)}{" "}
                balance · {item.giftsSentCount} gifts sent ({formatSantimAsBirr(item.giftsSentSantim)})
              </span>
            </div>
            <div className={styles.actions}>
              <select
                className={userStyles.roleSelect}
                value={item.role}
                disabled={savingId === item.id}
                onChange={(e) => changeRole(item.id, e.target.value)}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={item.isBanned ? styles.approveButton : styles.denyButton}
                disabled={savingId === item.id}
                onClick={() => toggleBan(item)}
              >
                {item.isBanned ? "Unban" : "Ban"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
