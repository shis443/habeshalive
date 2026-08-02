"use client";

import type { Notification } from "@habeshalive/shared";
import { Centrifuge } from "centrifuge";
import { useEffect, useState } from "react";
import { API_BASE_URL, CENTRIFUGO_WS_URL } from "@/lib/config";
import styles from "./TopNav.module.css";
import { BellIcon } from "./icons";

async function fetchToken(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/chat/token`, { method: "POST" });
  const data = await res.json();
  return data.token as string;
}

// E.6: real unread count (replacing the hardcoded 0) with live push over
// the existing Centrifugo connection — a `#<userId>`-suffixed channel is
// Centrifugo's built-in per-user channel restriction (see
// infra/centrifugo/config.json's "notifications" namespace and
// notifications/service.ts's channelForUser): only a connection
// authenticated as that exact user can subscribe to it, no custom
// subscribe-proxy logic needed.
export function NotificationBell({ isAuthed }: { isAuthed: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Fetched here rather than threaded as a prop through every TopNav call
  // site (dozens, across every page) — TopNav already does the same
  // client-side /auth/me fetch for sensitivePref, same reasoning.
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed) return;
    fetch("/api/backend/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setUserId(data.id))
      .catch(() => {});
    fetch("/api/backend/notifications/unread-count")
      .then((res) => (res.ok ? res.json() : { count: 0 }))
      .then((data) => setUnreadCount(data.count ?? 0))
      .catch(() => {});
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || !userId) return;
    let cancelled = false;
    const centrifuge = new Centrifuge(CENTRIFUGO_WS_URL, { getToken: fetchToken });
    const sub = centrifuge.newSubscription(`notifications:${userId}#${userId}`);
    sub.on("publication", (ctx) => {
      const data = ctx.data as { type: "unread_count"; count: number };
      if (!cancelled && data.type === "unread_count") setUnreadCount(data.count);
    });
    sub.subscribe();
    centrifuge.connect();
    return () => {
      cancelled = true;
      sub.unsubscribe();
      centrifuge.disconnect();
    };
  }, [isAuthed, userId]);

  function handleOpen() {
    setOpen((o) => !o);
    if (!open && items === null) {
      fetch("/api/backend/notifications")
        .then((res) => (res.ok ? res.json() : []))
        .then(setItems)
        .catch(() => setItems([]));
    }
  }

  async function markAllRead() {
    setUnreadCount(0);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
    await fetch("/api/backend/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  async function markRead(id: string) {
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) ?? prev);
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/backend/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  return (
    <div className={styles.dropdownWrap}>
      <button
        type="button"
        className={`${styles.iconButton} ${styles.badgeWrap}`}
        aria-label="Notifications"
        onClick={handleOpen}
      >
        <BellIcon />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && (
        <div className={`${styles.dropdown} ${styles.dropdownWide}`}>
          {!isAuthed || items === null ? (
            <p className={styles.emptyState}>No new notifications</p>
          ) : items.length === 0 ? (
            <p className={styles.emptyState}>No new notifications</p>
          ) : (
            <>
              {unreadCount > 0 && (
                <button type="button" className={styles.rowItem} onClick={markAllRead}>
                  <span className={styles.rowLabel}>Mark all as read</span>
                </button>
              )}
              {items.map((n) => (
                <a
                  key={n.id}
                  href={n.linkUrl ?? "#"}
                  className={styles.menuItem}
                  onClick={() => !n.readAt && markRead(n.id)}
                  style={{ opacity: n.readAt ? 0.6 : 1 }}
                >
                  <strong>{n.title}</strong>
                  {n.body && <div style={{ fontSize: 12 }}>{n.body}</div>}
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
