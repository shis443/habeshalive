"use client";

import type { Announcement } from "@birq/shared";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./AnnouncementBanner.module.css";
import { CloseIcon } from "./icons";

const STORAGE_KEY = "birq:dismissed-announcements";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

// D.2: platform-wide announcement banner, dismiss-persists across visits
// (localStorage, same pattern as the sidebar's collapse state) — keyed by
// announcement id, so dismissing one doesn't hide the next one an admin
// posts later. Hits the API directly, not the /api/backend proxy — public
// route, same reasoning as RecentGiftersStrip.
export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(readDismissed());
    fetch(`${API_BASE_URL}/announcements`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setAnnouncements)
      .catch(() => {});
  }, []);

  function dismiss(id: string) {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
  }

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {visible.map((a) => (
        <div key={a.id} className={styles.banner}>
          <p className={styles.text}>{a.body}</p>
          <div className={styles.actions}>
            {a.actionUrl && a.actionLabel && (
              <a href={a.actionUrl} className={styles.actionButton} target="_blank" rel="noopener noreferrer">
                {a.actionLabel}
              </a>
            )}
            <button type="button" className={styles.dismissButton} onClick={() => dismiss(a.id)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
