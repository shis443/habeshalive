import type { Notification, NotificationPreferences, NotificationType, UpdateNotificationPreferencesInput } from "@habeshalive/shared";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link_url: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    actorId: row.actor_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function channelForUser(userId: string): string {
  return `notifications:${userId}`;
}

// Same server-mediated-publish reasoning as chat/service.ts's
// publishToCentrifugo — reuses the already-live Centrifugo connection
// rather than polling, but every push is a nice-to-have on top of a
// durably-stored row, never the only copy of the notification.
// Found by actually running the new money-path tests locally (Centrifugo
// wasn't running): a non-2xx response was already handled, but a network-
// level failure (Centrifugo unreachable — connection refused, DNS, timeout)
// threw out of the bare `fetch` call instead. Every notify() caller in
// this codebase — sendGift, subscribe, redeemGiftCard, payout completion,
// banUser, and more — awaits notify() (several after already committing
// the real money movement), so an uncaught throw here meant a Centrifugo
// blip would make those requests report failure to the client even though
// the underlying operation had already succeeded. This is push-delivery
// only (the notification row itself is already durably committed by the
// time this runs — see notify()'s comment), so a failure here should never
// be able to fail the caller.
async function publishUnreadUpdate(userId: string, unreadCount: number): Promise<void> {
  try {
    const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
      method: "POST",
      headers: { "X-API-Key": env.CENTRIFUGO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "publish",
        params: { channel: channelForUser(userId), data: { type: "unread_count", count: unreadCount } },
      }),
    });
    if (!res.ok) {
      console.error(`[notifications] Centrifugo publish failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error(`[notifications] Centrifugo publish request failed:`, err);
  }
}

const PREFERENCE_COLUMN: Record<NotificationType, keyof NotificationPreferences | null> = {
  creator_live: "liveAlerts",
  gursha_received: "gurshaReceived",
  subscription_new: "subscriptionEvents",
  subscription_renewed: "subscriptionEvents",
  subscription_expiring: "subscriptionEvents",
  payout_processed: "payoutEvents",
  payout_failed: "payoutEvents",
  moderation_action: "moderationEvents",
  gift_card_received: "giftCardEvents",
  application_approved: null,
  application_rejected: null,
  ad_revenue_paid: "payoutEvents",
};

// Single-recipient notification (everything except creator_live, which
// has its own batched path below). Checks preferences first — a muted
// category writes nothing at all, not a row that's just never surfaced.
export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  options?: { body?: string; linkUrl?: string; actorId?: string }
): Promise<void> {
  const prefColumn = PREFERENCE_COLUMN[type];
  if (prefColumn) {
    const { rows } = await pool.query<Record<string, boolean>>(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId]
    );
    // No row yet means defaults apply (all TRUE except marketing — see
    // db/migrations/0024) — a user who's never touched notification
    // settings still gets notified, matching every column's DEFAULT TRUE.
    const dbColumn = prefColumn.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (rows[0] && rows[0][dbColumn] === false) return;
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notifications (user_id, type, title, body, link_url, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, type, title, options?.body ?? null, options?.linkUrl ?? null, options?.actorId ?? null]
  );
  if (!rows[0]) return;

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  await publishUnreadUpdate(userId, Number(countRows[0]!.count));
}

// E.6's explicit "must be batched" requirement: a creator with thousands
// of followers going live is thousands of rows and thousands of pushes —
// this does ONE bulk INSERT (preference check folded into its own JOIN,
// not a per-follower SELECT) and ONE bulk COUNT for the resulting unread
// totals, then fires the N unavoidable Centrifugo publishes (one per
// follower's own channel — that's inherent to a per-user channel model,
// not something batching can reduce further) concurrently and detached
// from the caller, so a creator with a huge follower list going live
// doesn't make goLive() itself slow.
export async function notifyFollowersCreatorLive(
  creatorId: string,
  creatorUsername: string,
  creatorDisplayName: string
): Promise<void> {
  const { rows: inserted } = await pool.query<{ user_id: string }>(
    `INSERT INTO notifications (user_id, type, title, link_url, actor_id)
     SELECT f.follower_id, 'creator_live', $2 || ' is live', '/watch/' || $3, $1
     FROM follows f
     LEFT JOIN notification_preferences np ON np.user_id = f.follower_id
     WHERE f.creator_id = $1 AND COALESCE(np.live_alerts, TRUE) = TRUE
     RETURNING user_id`,
    [creatorId, creatorDisplayName, creatorUsername]
  );
  if (inserted.length === 0) return;

  const followerIds = inserted.map((r) => r.user_id);
  const { rows: counts } = await pool.query<{ user_id: string; count: string }>(
    `SELECT user_id, count(*) FROM notifications WHERE user_id = ANY($1::uuid[]) AND read_at IS NULL GROUP BY user_id`,
    [followerIds]
  );
  const countByUser = new Map(counts.map((r) => [r.user_id, Number(r.count)]));

  // Detached on purpose (no await at the call site — see
  // streams/service.ts's goLive) — a slow/failed push shouldn't delay or
  // fail the go-live request itself; the notifications are already
  // durably stored regardless of whether the real-time push lands.
  Promise.all(followerIds.map((userId) => publishUnreadUpdate(userId, countByUser.get(userId) ?? 0))).catch((err) => {
    console.error("[notifications] batched live-alert publish failed:", err);
  });
}

export async function listNotifications(userId: string, limit = 30, before?: string): Promise<Notification[]> {
  const { rows } = await pool.query<NotificationRow>(
    `SELECT id, type, title, body, link_url, actor_id, read_at, created_at
     FROM notifications
     WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, before ?? null, limit]
  );
  return rows.map(toNotification);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return Number(rows[0]!.count);
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId]
  );
  if (!rowCount) return;
  await publishUnreadUpdate(userId, await getUnreadCount(userId));
}

export async function markAllRead(userId: string): Promise<void> {
  await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  await publishUnreadUpdate(userId, 0);
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  liveAlerts: true,
  gurshaReceived: true,
  subscriptionEvents: true,
  payoutEvents: true,
  moderationEvents: true,
  giftCardEvents: true,
  marketing: false,
};

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const { rows } = await pool.query<{
    live_alerts: boolean;
    gursha_received: boolean;
    subscription_events: boolean;
    payout_events: boolean;
    moderation_events: boolean;
    gift_card_events: boolean;
    marketing: boolean;
  }>(`SELECT * FROM notification_preferences WHERE user_id = $1`, [userId]);
  const row = rows[0];
  if (!row) return DEFAULT_PREFERENCES;
  return {
    liveAlerts: row.live_alerts,
    gurshaReceived: row.gursha_received,
    subscriptionEvents: row.subscription_events,
    payoutEvents: row.payout_events,
    moderationEvents: row.moderation_events,
    giftCardEvents: row.gift_card_events,
    marketing: row.marketing,
  };
}

export async function updatePreferences(
  userId: string,
  input: UpdateNotificationPreferencesInput
): Promise<NotificationPreferences> {
  const current = await getPreferences(userId);
  const merged = { ...current, ...input };
  await pool.query(
    `INSERT INTO notification_preferences
       (user_id, live_alerts, gursha_received, subscription_events, payout_events, moderation_events, gift_card_events, marketing)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       live_alerts = $2, gursha_received = $3, subscription_events = $4, payout_events = $5,
       moderation_events = $6, gift_card_events = $7, marketing = $8`,
    [
      userId,
      merged.liveAlerts,
      merged.gurshaReceived,
      merged.subscriptionEvents,
      merged.payoutEvents,
      merged.moderationEvents,
      merged.giftCardEvents,
      merged.marketing,
    ]
  );
  return merged;
}
