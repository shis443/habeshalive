import type { ChatMessage } from "@habeshalive/shared";
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

// Server-mediated publish (not direct client->Centrifugo publish): lets
// this go through the same moderation/ban checks as any other write, and
// keeps chat_messages as the durable source of truth with Centrifugo only
// responsible for low-latency fan-out, not storage.
async function publishToCentrifugo(streamId: string, message: ChatMessage): Promise<void> {
  const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
    method: "POST",
    headers: {
      "X-API-Key": env.CENTRIFUGO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "publish",
      params: { channel: channelForStream(streamId), data: message },
    }),
  });
  if (!res.ok) {
    // Don't fail the whole request over a real-time fan-out hiccup — the
    // message is already durably stored; a viewer who reloads (or the
    // next GET /chat/:streamId/messages poll) still sees it. Only the
    // instant push is lost.
    console.error(`[chat] Centrifugo publish failed: ${res.status} ${await res.text().catch(() => "")}`);
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
       (SELECT avatar_url FROM users WHERE id = $2) AS avatar_url`,
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
  await publishToCentrifugo(streamId, message);
  return message;
}

export async function getChatHistory(streamId: string): Promise<ChatMessage[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `SELECT cm.id, cm.stream_id, cm.user_id, cm.body, cm.created_at,
            u.username, u.display_name, u.avatar_url
     FROM chat_messages cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.stream_id = $1 AND cm.is_deleted = FALSE
     ORDER BY cm.created_at DESC
     LIMIT 50`,
    [streamId]
  );
  return rows.map(toChatMessage).reverse();
}
