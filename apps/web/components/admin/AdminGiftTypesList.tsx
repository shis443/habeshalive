"use client";

import { formatSantimAsBirr, type AdminGiftType } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import giftStyles from "./AdminGiftTypesList.module.css";

interface EditState {
  priceBirr: string;
  isActive: boolean;
  category: string;
  creatorShareBpsPct: string;
  availableFrom: string; // datetime-local value, "" = unset
  availableUntil: string;
  regions: string; // comma-separated, "" = unset
  reason: string;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time,
// not an ISO string with a timezone offset or seconds.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function editStateFrom(item: AdminGiftType): EditState {
  return {
    priceBirr: String(item.priceSantim / 100),
    isActive: item.isActive,
    category: item.category,
    creatorShareBpsPct: String(item.creatorShareBps / 100),
    availableFrom: toLocalInputValue(item.availableFrom),
    availableUntil: toLocalInputValue(item.availableUntil),
    regions: item.regions?.join(", ") ?? "",
    reason: "",
  };
}

export function AdminGiftTypesList({ items }: { items: AdminGiftType[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleExpand(item: AdminGiftType) {
    if (expandedId === item.id) {
      setExpandedId(null);
      setEdit(null);
      return;
    }
    setExpandedId(item.id);
    setEdit(editStateFrom(item));
    setError(null);
  }

  async function save(id: string) {
    if (!edit || !edit.reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const regions = edit.regions
        .split(",")
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean);
      const res = await fetch(`/api/backend/admin/gift-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceSantim: Math.round(parseFloat(edit.priceBirr || "0") * 100),
          isActive: edit.isActive,
          category: edit.category.trim() || undefined,
          creatorShareBps: Math.round(parseFloat(edit.creatorShareBpsPct || "0") * 100),
          availableFrom: fromLocalInputValue(edit.availableFrom),
          availableUntil: fromLocalInputValue(edit.availableUntil),
          regions: regions.length > 0 ? regions : null,
          reason: edit.reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      setExpandedId(null);
      setEdit(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No gift types found.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => {
          const now = Date.now();
          const outOfWindow =
            (item.availableFrom && new Date(item.availableFrom).getTime() > now) ||
            (item.availableUntil && new Date(item.availableUntil).getTime() <= now);

          return (
            <div key={item.id} className={styles.rowStack}>
              <div className={`${styles.row} ${styles.rowExpandable}`} onClick={() => toggleExpand(item)}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {item.name}
                    {!item.isActive && <span className={giftStyles.inactiveBadge}>Inactive</span>}
                    {item.isActive && outOfWindow && (
                      <span className={giftStyles.windowBadge}>Outside window</span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>
                    {formatSantimAsBirr(item.priceSantim)} · {item.category} ·{" "}
                    {(item.creatorShareBps / 100).toFixed(0)}% reference split
                    {item.tierKey ? ` · ${item.tierKey} tier` : ""}
                  </span>
                </div>
              </div>

              {expandedId === item.id && edit && (
                <div className={giftStyles.detail} onClick={(e) => e.stopPropagation()}>
                  <div className={giftStyles.fieldGrid}>
                    <div className={giftStyles.field}>
                      <label>Price (ETB)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={edit.priceBirr}
                        onChange={(e) => setEdit({ ...edit, priceBirr: e.target.value })}
                      />
                    </div>
                    <div className={giftStyles.field}>
                      <label>Category</label>
                      <input
                        type="text"
                        value={edit.category}
                        onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                      />
                    </div>
                    <div className={giftStyles.field}>
                      <label>Active</label>
                      <select
                        value={edit.isActive ? "true" : "false"}
                        onChange={(e) => setEdit({ ...edit, isActive: e.target.value === "true" })}
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </div>
                    <div className={giftStyles.field}>
                      <label>Creator share (%, reference)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        value={edit.creatorShareBpsPct}
                        onChange={(e) => setEdit({ ...edit, creatorShareBpsPct: e.target.value })}
                      />
                    </div>
                    <div className={giftStyles.field}>
                      <label>Available from</label>
                      <input
                        type="datetime-local"
                        value={edit.availableFrom}
                        onChange={(e) => setEdit({ ...edit, availableFrom: e.target.value })}
                      />
                    </div>
                    <div className={giftStyles.field}>
                      <label>Available until</label>
                      <input
                        type="datetime-local"
                        value={edit.availableUntil}
                        onChange={(e) => setEdit({ ...edit, availableUntil: e.target.value })}
                      />
                    </div>
                    <div className={giftStyles.field}>
                      <label>Regions (ISO-3166-1 alpha-2, comma-separated; blank = everywhere)</label>
                      <input
                        type="text"
                        placeholder="ET, US"
                        value={edit.regions}
                        onChange={(e) => setEdit({ ...edit, regions: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className={giftStyles.referenceNote}>
                    Creator share here is a planning reference only — it does not change any real payout. Every
                    send actually splits by the creator&apos;s own negotiated rate (Creators page).
                  </p>
                  <div className={giftStyles.reasonRow}>
                    <input
                      type="text"
                      placeholder="Reason for this change (required)"
                      value={edit.reason}
                      onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                    />
                    <button
                      type="button"
                      className={giftStyles.saveButton}
                      disabled={saving || !edit.reason.trim()}
                      onClick={() => save(item.id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
