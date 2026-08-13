"use client";

import type { Notification, NotificationType } from "@birq/shared";
import { Centrifuge } from "centrifuge";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import { CENTRIFUGO_WS_URL } from "@/lib/config";
import { formatRelativeTime } from "@/lib/format";
import styles from "./NotificationBell.module.css";
import { BellIcon, CloseIcon, GearIcon, GoLiveIcon } from "./icons";

// Unlike ChatPanel's fetchChatToken (deliberately calls the API directly
// so anonymous viewers get a connection token too — public chat needs no
// identity), this MUST go through the authenticated /api/backend proxy:
// the notifications channel is user-restricted (Centrifugo's `#user_id`
// mechanism — see infra/centrifugo/config.json), so the token has to
// carry the real signed-in user's id or Centrifugo correctly rejects the
// subscription with "permission denied". A direct cross-origin call to
// the API can't carry the httpOnly session cookie at all, so it always
// resolves to an anonymous token — confirmed live via raw WS frame
// inspection before this fix (subscribe attempt came back
// {"error":{"code":103,"message":"permission denied"}}).
async function fetchToken(): Promise<string> {
  const res = await fetch("/api/backend/chat/token", { method: "POST" });
  const data = await unwrapClientData<{ token: string }>(res);
  return data.token;
}

// Twitch-style two-tab split ("Following" vs "My Channel"), derived from
// the real notificationTypeSchema enum rather than a fabricated second
// field — 'creator_live' is the only type about someone else's channel;
// every other type (gifts, subscriptions, payouts, moderation,
// applications, KYC, ad revenue, donations, PPV) is about the signed-in
// user's own account/channel.
const FOLLOWING_TYPES = new Set<NotificationType>(["creator_live"]);

function NotificationIcon({ type }: { type: NotificationType }) {
  return FOLLOWING_TYPES.has(type) ? <GoLiveIcon /> : <BellIcon />;
}

function SmileyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 10h3M13.5 10h3" />
      <path d="M8 14.5c1.5 1.5 6.5 1.5 8 0" />
    </svg>
  );
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
  const [tab, setTab] = useState<"following" | "channel">("following");
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Fetched here rather than threaded as a prop through every TopNav call
  // site (dozens, across every page) — TopNav already does the same
  // client-side /auth/me fetch for sensitivePref, same reasoning.
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed) return;
    fetch("/api/backend/auth/me")
      .then((res) => (res.ok ? unwrapClientData<{ id: string }>(res) : null))
      .then((data) => data && setUserId(data.id))
      .catch(() => {});
    fetch("/api/backend/notifications/unread-count")
      .then((res) => (res.ok ? unwrapClientData<{ count: number }>(res) : { count: 0 }))
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
        .then((res) => (res.ok ? unwrapClientData<Notification[]>(res) : []))
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

  const followingItems = useMemo(() => items?.filter((n) => FOLLOWING_TYPES.has(n.type)) ?? [], [items]);
  const channelItems = useMemo(() => items?.filter((n) => !FOLLOWING_TYPES.has(n.type)) ?? [], [items]);
  const activeItems = tab === "following" ? followingItems : channelItems;
  const hasUnread = items !== null && items.some((n) => !n.readAt);

  return (
    <div className={styles.wrap}>
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
        <div className={styles.panel}>
          <div className={styles.header}>
            <span className={styles.spacer} />
            <h3 className={styles.title}>Notifications</h3>
            <div className={styles.headerActions}>
              <Link href="/settings?tab=notifications" className={styles.iconButton} aria-label="Notification settings" title="Notification settings">
                <GearIcon />
              </Link>
              <button type="button" className={styles.iconButton} aria-label="Close" onClick={() => setOpen(false)}>
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === "following" ? styles.tabActive : ""}`}
              onClick={() => setTab("following")}
            >
              Following
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "channel" ? styles.tabActive : ""}`}
              onClick={() => setTab("channel")}
            >
              My Channel
            </button>
          </div>

          <div className={styles.body}>
            {!isAuthed || items === null || activeItems.length === 0 ? (
              tab === "following" ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    <SmileyIcon />
                  </div>
                  <p className={styles.emptyTitle}>You&apos;re all caught up. What a pro!</p>
                  <p className={styles.emptyBody}>You have no messages.</p>
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    <GoLiveIcon />
                  </div>
                  <p className={styles.emptyTitle}>New to streaming? Try it out!</p>
                  <p className={styles.emptyBody}>Share your hobbies and meet new friends.</p>
                  <Link href="/dashboard" className={styles.emptyAction}>
                    Go to Creator Dashboard
                  </Link>
                </div>
              )
            ) : (
              <>
                {hasUnread && (
                  <div className={styles.markAllRow}>
                    <button type="button" className={styles.markAllButton} onClick={markAllRead}>
                      Mark all as read
                    </button>
                  </div>
                )}
                <div className={styles.list}>
                  {activeItems.map((n) => (
                    <a
                      key={n.id}
                      href={n.linkUrl ?? "#"}
                      className={`${styles.row} ${!n.readAt ? styles.rowUnread : ""}`}
                      onClick={() => !n.readAt && markRead(n.id)}
                    >
                      <span className={styles.rowIcon}>
                        <NotificationIcon type={n.type} />
                      </span>
                      <span className={styles.rowContent}>
                        <p className={styles.rowTitle}>{n.title}</p>
                        {n.body && <p className={styles.rowBody}>{n.body}</p>}
                        <span className={styles.rowTime}>{formatRelativeTime(n.createdAt)}</span>
                      </span>
                      {!n.readAt && <span className={styles.unreadDot} />}
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
