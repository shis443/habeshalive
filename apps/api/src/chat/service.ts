import type { ChatMessage, GifterBadgeTier, PinnedMessage, Rank, RecentGifter } from "@habeshalive/shared";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { flagIfMatched } from "../moderation/service.js";

interface ChatMessageRow {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  gifter_badge_tier: GifterBadgeTier | null;
  sender_role: ChatMessage["senderRole"];
  subscriber_months: number | null;
  rank: Rank | null;
  has_sub_shield: boolean;
  created_at: string;
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    streamId: row.stream_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    body: row.body,
    gifterBadgeTier: row.gifter_badge_tier ?? "none",
    senderRole: row.sender_role,
    subscriberMonths: row.subscriber_months,
    rank: row.rank ?? "newari",
    hasSubShield: row.has_sub_shield,
    createdAt: row.created_at,
  };
}

function channelForStream(streamId: string): string {
  // Matches the "stream-chat" namespace configured in
  // infra/centrifugo/config.json (history_size/history_ttl live there,
  // not here) — the channel name itself just needs the "namespace:rest"
  // shape Centrifugo's namespace routing expects.
  return `stream-chat:${streamId}`;
}

// Shared by getChatHistory and loadPinnedMessage (both need "this message's
// sender, with role/gifter-tier/subscriber-tenure") — one copy so they
// can't drift the way search/service.ts's independent stream mapping once
// did (see C.6's handoff notes). Expects cm.user_id (the message row's
// sender) and s.creator_id (the stream row, joined separately by each
// caller) already in scope.
const CHAT_SENDER_JOIN_COLUMNS = `
  u.username, u.display_name, u.avatar_url, u.role AS sender_role,
  gb.tier AS gifter_badge_tier,
  (EXTRACT(YEAR FROM age(now(), sub.started_at)) * 12
   + EXTRACT(MONTH FROM age(now(), sub.started_at)))::int AS subscriber_months,
  ur.rank,
  (psub.id IS NOT NULL) AS has_sub_shield
`;
const CHAT_SENDER_JOINS = `
  JOIN users u ON u.id = cm.user_id
  LEFT JOIN gifter_badges gb ON gb.user_id = cm.user_id AND gb.creator_id = s.creator_id
  LEFT JOIN subscriptions sub ON sub.subscriber_id = cm.user_id AND sub.creator_id = s.creator_id AND sub.status = 'active'
  LEFT JOIN user_ranks ur ON ur.user_id = cm.user_id
  LEFT JOIN platform_subscriptions psub ON psub.subscriber_id = cm.user_id AND psub.status = 'active'
`;

// sendChatMessage's RETURNING clause can't use the JOIN form above (it has
// no FROM to join against) — same three facts, as correlated subqueries
// against the just-inserted row's own $2 (user_id) / $1 (stream_id) params.
const SENDER_ROLE_AND_TENURE_RETURNING_SQL = `
  (SELECT gb.tier FROM gifter_badges gb
   JOIN streams s ON s.id = $1 AND s.creator_id = gb.creator_id
   WHERE gb.user_id = $2) AS gifter_badge_tier,
  (SELECT role FROM users WHERE id = $2) AS sender_role,
  (SELECT (EXTRACT(YEAR FROM age(now(), sub.started_at)) * 12
           + EXTRACT(MONTH FROM age(now(), sub.started_at)))::int
   FROM subscriptions sub
   JOIN streams s ON s.id = $1 AND s.creator_id = sub.creator_id
   WHERE sub.subscriber_id = $2 AND sub.status = 'active') AS subscriber_months,
  (SELECT rank FROM user_ranks WHERE user_id = $2) AS rank,
  EXISTS (SELECT 1 FROM platform_subscriptions WHERE subscriber_id = $2 AND status = 'active') AS has_sub_shield
`;

// Server-mediated publish (not direct client->Centrifugo publish): lets
// this go through the same moderation/ban checks as any other write, and
// keeps chat_messages as the durable source of truth with Centrifugo only
// responsible for low-latency fan-out, not storage.
//
// Wrapped in a {type, ...} envelope (not a raw ChatMessage) so pin/unpin
// events (see publishPinUpdate below) can share this same channel instead
// of needing a second WebSocket subscription just for a rare, low-volume
// event — apps/web/components/ChatPanel.tsx's subscription handler
// dispatches on `type`.
async function publishToCentrifugo(channel: string, data: unknown): Promise<void> {
  // The whole fetch is wrapped, not just the !res.ok branch below — a
  // network-level failure (Centrifugo unreachable) throws out of a bare
  // fetch() call before there's even a response to check, which the
  // !res.ok branch alone can't catch. Found by actually running Centrifugo-
  // adjacent tests locally without Centrifugo running (see
  // notifications/service.ts's publishUnreadUpdate for the same fix and
  // the fuller writeup) — without this, the comment below ("don't fail the
  // whole request") wasn't actually true for this failure mode.
  try {
    const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
      method: "POST",
      headers: {
        "X-API-Key": env.CENTRIFUGO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "publish", params: { channel, data } }),
    });
    if (!res.ok) {
      // Don't fail the whole request over a real-time fan-out hiccup — the
      // underlying write is already durably stored; a viewer who reloads
      // (or the next poll) still sees it. Only the instant push is lost.
      console.error(`[chat] Centrifugo publish failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error(`[chat] Centrifugo publish request failed:`, err);
  }
}

export async function sendChatMessage(userId: string, streamId: string, body: string): Promise<ChatMessage> {
  const stream = await pool.query(`SELECT 1 FROM streams WHERE id = $1`, [streamId]);
  if (stream.rows.length === 0) throw new AppError(404, "Stream not found");

  const { rows } = await pool.query<ChatMessageRow>(
    `INSERT INTO chat_messages (stream_id, user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, stream_id, user_id, body, created_at,
       (SELECT username FROM users WHERE id = $2) AS username,
       (SELECT display_name FROM users WHERE id = $2) AS display_name,
       (SELECT avatar_url FROM users WHERE id = $2) AS avatar_url,
       ${SENDER_ROLE_AND_TENURE_RETURNING_SQL}`,
    [streamId, userId, body]
  );
  const row = rows[0];
  if (!row) throw new AppError(500, "Failed to store message");
  const message = toChatMessage(row);
  // Same after-the-fact flag-for-review as stream titles and gift
  // messages (never blocks/deletes) — chat is the highest-volume text
  // surface on the platform and, unlike those two, was never scanned at
  // all until now.
  await flagIfMatched("chat_message", message.id, userId, body);
  await publishToCentrifugo(channelForStream(streamId), { type: "message", message });
  return message;
}

export async function getChatHistory(streamId: string): Promise<ChatMessage[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `SELECT cm.id, cm.stream_id, cm.user_id, cm.body, cm.created_at, ${CHAT_SENDER_JOIN_COLUMNS}
     FROM chat_messages cm
     JOIN streams s ON s.id = cm.stream_id
     ${CHAT_SENDER_JOINS}
     WHERE cm.stream_id = $1 AND cm.is_deleted = FALSE
     ORDER BY cm.created_at DESC
     LIMIT 50`,
    [streamId]
  );
  return rows.map(toChatMessage).reverse();
}

// Shared by pin/unpin: the stream's own creator can always moderate their
// own chat; platform moderator/admin roles can moderate any stream. No
// separate per-creator "chat moderator" concept exists — see D.2's handoff
// note on why this reuses the existing platform role instead of adding one.
async function assertCanModerateStream(actorId: string, streamId: string): Promise<void> {
  const { rows } = await pool.query<{ creator_id: string; role: string }>(
    `SELECT s.creator_id, u.role FROM streams s, users u WHERE s.id = $1 AND u.id = $2`,
    [streamId, actorId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "Stream not found");
  const isOwner = row.creator_id === actorId;
  // db/migrations/0026_rbac_role_isolation.sql renamed the old flat
  // 'admin' role to 'super_admin' — finance_auditor is deliberately
  // excluded here (read-only financial access, not a content-moderation
  // grant).
  const isStaff = row.role === "moderator" || row.role === "super_admin";
  if (!isOwner && !isStaff) throw new AppError(403, "Only the creator or a moderator can do this");
}

async function loadPinnedMessage(streamId: string): Promise<PinnedMessage | null> {
  const { rows } = await pool.query<ChatMessageRow & { pinned_by_username: string; pinned_at: string }>(
    `SELECT cm.id, cm.stream_id, cm.user_id, cm.body, cm.created_at, ${CHAT_SENDER_JOIN_COLUMNS},
            pu.username AS pinned_by_username, pm.pinned_at
     FROM pinned_messages pm
     JOIN chat_messages cm ON cm.id = pm.message_id
     JOIN users pu ON pu.id = pm.pinned_by
     JOIN streams s ON s.id = cm.stream_id
     ${CHAT_SENDER_JOINS}
     WHERE pm.stream_id = $1`,
    [streamId]
  );
  const row = rows[0];
  if (!row) return null;
  return { message: toChatMessage(row), pinnedByUsername: row.pinned_by_username, pinnedAt: row.pinned_at };
}

export async function getPinnedMessage(streamId: string): Promise<PinnedMessage | null> {
  return loadPinnedMessage(streamId);
}

export async function pinMessage(actorId: string, streamId: string, messageId: string): Promise<PinnedMessage> {
  await assertCanModerateStream(actorId, streamId);
  const message = await pool.query(`SELECT 1 FROM chat_messages WHERE id = $1 AND stream_id = $2`, [
    messageId,
    streamId,
  ]);
  if (message.rows.length === 0) throw new AppError(404, "Message not found");

  await pool.query(
    `INSERT INTO pinned_messages (stream_id, message_id, pinned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (stream_id) DO UPDATE SET message_id = $2, pinned_by = $3, pinned_at = now()`,
    [streamId, messageId, actorId]
  );
  const pinned = await loadPinnedMessage(streamId);
  if (!pinned) throw new AppError(500, "Failed to load pinned message");
  await publishToCentrifugo(channelForStream(streamId), { type: "pin", pinnedMessage: pinned });
  return pinned;
}

export async function unpinMessage(actorId: string, streamId: string): Promise<void> {
  await assertCanModerateStream(actorId, streamId);
  await pool.query(`DELETE FROM pinned_messages WHERE stream_id = $1`, [streamId]);
  await publishToCentrifugo(channelForStream(streamId), { type: "pin", pinnedMessage: null });
}

// D.2 recent-gifter strip. Grouped by (sender, is_anonymous) rather than
// just sender: someone who sent both an anonymous and a named gift in the
// same stream shows as two separate entries — merging them would either
// leak that the anonymous one was them, or hide the named one. Anonymous
// entries carry no identifying fields.
export async function getRecentGifters(streamId: string): Promise<RecentGifter[]> {
  const { rows } = await pool.query<{
    sender_id: string | null;
    username: string | null;
    avatar_url: string | null;
    is_anonymous: boolean;
    total_santim: string;
  }>(
    `SELECT
       CASE WHEN gs.is_anonymous THEN NULL ELSE gs.sender_id END AS sender_id,
       CASE WHEN gs.is_anonymous THEN NULL ELSE u.username END AS username,
       CASE WHEN gs.is_anonymous THEN NULL ELSE u.avatar_url END AS avatar_url,
       gs.is_anonymous,
       sum(gt.price_santim * gs.quantity)::text AS total_santim
     FROM gifts_sent gs
     JOIN gift_types gt ON gt.id = gs.gift_type_id
     JOIN users u ON u.id = gs.sender_id
     WHERE gs.stream_id = $1
     GROUP BY gs.sender_id, u.username, u.avatar_url, gs.is_anonymous
     ORDER BY sum(gt.price_santim * gs.quantity) DESC
     LIMIT 12`,
    [streamId]
  );
  return rows.map((row) => ({
    userId: row.sender_id,
    username: row.username,
    avatarUrl: row.avatar_url,
    totalSantim: Number(row.total_santim),
    isAnonymous: row.is_anonymous,
  }));
}
