import type { RemoteControlAssistant } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

// Grant/revoke for remote_control_assistants (db/migrations/0040) — the
// creator-settings counterpart to ticket-service.ts's resolveScope(),
// which is what actually reads this table at connect time. Mirrors
// moderation/channel-mods-service.ts's grant/revoke shape closely
// (assertIsChannelOwner, grant-by-username, 404 on an unknown username),
// with one real difference: this table soft-deletes (revoked_at), not a
// hard DELETE — a remote-control grant is security-sensitive enough that
// "who had access to drive my broadcast, and when" should stay
// inspectable after the fact, same reasoning as db/migrations/0040's own
// comment on the partial index.

function assertIsStreamerOwner(streamerId: string, actorId: string): void {
  if (actorId !== streamerId) throw new AppError(403, "Only the streamer can manage remote control assistants");
}

interface AssistantRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  granted_at: string;
}

export async function listRemoteControlAssistants(
  streamerId: string,
  actorId: string
): Promise<RemoteControlAssistant[]> {
  assertIsStreamerOwner(streamerId, actorId);
  const { rows } = await pool.query<AssistantRow>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, a.granted_at
     FROM remote_control_assistants a
     JOIN users u ON u.id = a.assistant_user_id
     WHERE a.streamer_id = $1 AND a.revoked_at IS NULL
     ORDER BY a.granted_at ASC`,
    [streamerId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    grantedAt: r.granted_at,
  }));
}

export async function grantRemoteControlAssistant(
  streamerId: string,
  actorId: string,
  assistantUsername: string
): Promise<RemoteControlAssistant> {
  assertIsStreamerOwner(streamerId, actorId);
  const { rows: userRows } = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
    `SELECT id, display_name, avatar_url FROM users WHERE username = $1`,
    [assistantUsername]
  );
  const target = userRows[0];
  if (!target) throw new AppError(404, "No user with that username");
  if (target.id === streamerId) throw new AppError(400, "You can't grant yourself remote control access");

  // ON CONFLICT re-activates a previously revoked grant instead of
  // erroring on the UNIQUE (streamer_id, assistant_user_id) constraint —
  // granted_at/granted_by refresh to reflect the new grant, revoked_at
  // clears. A brand new row hits the same UNIQUE constraint's happy path
  // via plain INSERT.
  const { rows } = await pool.query<{ granted_at: string }>(
    `INSERT INTO remote_control_assistants (streamer_id, assistant_user_id, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (streamer_id, assistant_user_id)
     DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL
     RETURNING granted_at`,
    [streamerId, target.id, actorId]
  );

  await logAdminAction(actorId, "remote_control.assistant_granted", "streamer", streamerId, {
    metadata: { assistantUserId: target.id },
  });

  return {
    userId: target.id,
    username: assistantUsername,
    displayName: target.display_name,
    avatarUrl: target.avatar_url,
    grantedAt: rows[0]!.granted_at,
  };
}

export async function revokeRemoteControlAssistant(
  streamerId: string,
  actorId: string,
  assistantUserId: string
): Promise<void> {
  assertIsStreamerOwner(streamerId, actorId);
  const { rows } = await pool.query(
    `UPDATE remote_control_assistants SET revoked_at = now()
      WHERE streamer_id = $1 AND assistant_user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [streamerId, assistantUserId]
  );
  if (!rows[0]) throw new AppError(404, "That user isn't a remote control assistant on your stream");

  await logAdminAction(actorId, "remote_control.assistant_revoked", "streamer", streamerId, {
    metadata: { assistantUserId },
  });
}
