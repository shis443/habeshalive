"use client";

import type { AdminAuditAction } from "@birq/shared";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import diffStyles from "./AuditLogList.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(", ");
}

// A flat key/value diff, not a generic deep-object differ: every
// before/after pair logged across the codebase (see admin/audit.ts's own
// call-site convention) is a small, flat snapshot — {isBanned: false} vs
// {isBanned: true} — never a nested structure, so this doesn't need to be
// more general than what's actually written.
function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Array<{ key: string; before: unknown; after: unknown; changed: boolean }> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].sort().map((key) => {
    const b = before?.[key];
    const a = after?.[key];
    return { key, before: b, after: a, changed: JSON.stringify(b) !== JSON.stringify(a) };
  });
}

function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function BeforeAfterDiff({ before, after }: { before: unknown; after: unknown }) {
  const [open, setOpen] = useState(false);
  const b = (before ?? null) as Record<string, unknown> | null;
  const a = (after ?? null) as Record<string, unknown> | null;
  if (b === null && a === null) return null;
  const rows = diffRows(b, a);

  return (
    <div className={diffStyles.diffWrap}>
      <button type="button" className={diffStyles.diffToggle} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} before/after
      </button>
      {open && (
        <table className={diffStyles.diffTable}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.changed ? diffStyles.diffChanged : undefined}>
                <td>{row.key}</td>
                <td>{formatValue(row.before)}</td>
                <td>{formatValue(row.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AuditLogList({ items }: { items: AdminAuditAction[] }) {
  if (items.length === 0) return <p className={styles.empty}>No admin actions match this filter.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const metadata = formatMetadata(item.metadata);
        return (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                @{item.actorUsername} — {item.action}
                {item.targetId ? ` (${item.targetType}: ${item.targetId.slice(0, 8)})` : ` (${item.targetType})`}
              </span>
              {item.reason && <span className={styles.rowMeta}>Reason: {item.reason}</span>}
              {metadata && <span className={styles.rowMeta}>{metadata}</span>}
              <span className={styles.rowMeta}>
                {item.actorIp ?? "no IP recorded"}
                {item.actorSessionId && (
                  <>
                    {" · "}
                    <a href={`/admin/audit-log?session=${item.actorSessionId}`}>
                      session {item.actorSessionId.slice(0, 8)}
                    </a>
                  </>
                )}
              </span>
              <BeforeAfterDiff before={item.beforeState} after={item.afterState} />
            </div>
            <span className={styles.rowMeta}>{formatDate(item.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
