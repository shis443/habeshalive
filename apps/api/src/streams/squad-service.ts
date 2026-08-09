import { randomInt } from "node:crypto";
import type { Squad, SquadMember } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { getLiveStreamByCreatorId } from "./service.js";

// Module 3 (Broadcasting Infra & Apps) — squad co-streaming, scoped as
// grid-view orchestration over already-independently-live streams, not a
// new WebRTC mesh/SFU. A squad is just a small group of creators; the
// grid a viewer sees is N ordinary VideoPlayer instances (one per
// member's own existing playback URL), synced only in the loose sense
// that they're all playing live at once — same infra every other stream
// on this platform already uses (SRS HLS/WHEP), no new real-time
// transport. "4-way squad" from the original spec becomes MAX_SQUAD_SIZE
// below, not a literal mesh topology limit.
const MAX_SQUAD_SIZE = 4;

// Same alphabet/shape as gift-cards/service.ts's generateCode — short
// enough to read off a screen and call out on stream, ambiguous
// characters (0/O, 1/I/L) excluded.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateInviteCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

interface SquadRow {
  id: string;
  name: string | null;
  invite_code: string;
}

interface MemberRow {
  creator_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

async function requireLive(creatorId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM streams WHERE creator_id = $1 AND status = 'live'`, [creatorId]);
  if (!rows[0]) throw new AppError(400, "You must be live to use squad co-streaming");
}

async function activeMembership(creatorId: string): Promise<{ squad_id: string } | null> {
  const { rows } = await pool.query<{ squad_id: string }>(
    `SELECT squad_id FROM squad_members WHERE creator_id = $1 AND left_at IS NULL`,
    [creatorId]
  );
  return rows[0] ?? null;
}

async function buildSquad(squadRow: SquadRow, viewerId: string | undefined): Promise<Squad> {
  const { rows: memberRows } = await pool.query<MemberRow>(
    `SELECT u.id AS creator_id, u.username, u.display_name, u.avatar_url
     FROM squad_members sm
     JOIN users u ON u.id = sm.creator_id
     WHERE sm.squad_id = $1 AND sm.left_at IS NULL
     ORDER BY sm.joined_at ASC`,
    [squadRow.id]
  );

  const members: SquadMember[] = await Promise.all(
    memberRows.map(async (m) => ({
      creatorId: m.creator_id,
      username: m.username,
      displayName: m.display_name,
      avatarUrl: m.avatar_url,
      stream: await getLiveStreamByCreatorId(m.creator_id, viewerId),
    }))
  );

  return { id: squadRow.id, name: squadRow.name, inviteCode: squadRow.invite_code, members };
}

export async function createSquad(creatorId: string, name?: string): Promise<Squad> {
  await requireLive(creatorId);
  if (await activeMembership(creatorId)) {
    throw new AppError(400, "You're already in a squad — leave it first");
  }

  // Collision odds on a 6-char code from a 32-symbol alphabet are
  // astronomically low, but the column has a real UNIQUE constraint —
  // retry on the off chance rather than trusting probability alone. Same
  // pattern as gift-cards/service.ts's purchaseGiftCard.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInviteCode();
    const { rows } = await pool.query<SquadRow>(
      `INSERT INTO squads (created_by, name, invite_code) VALUES ($1, $2, $3)
       ON CONFLICT (invite_code) DO NOTHING
       RETURNING id, name, invite_code`,
      [creatorId, name ?? null, candidate]
    );
    const squad = rows[0];
    if (squad) {
      await pool.query(`INSERT INTO squad_members (squad_id, creator_id) VALUES ($1, $2)`, [squad.id, creatorId]);
      return buildSquad(squad, creatorId);
    }
  }
  throw new AppError(500, "Couldn't generate a unique invite code — try again");
}

export async function joinSquad(creatorId: string, inviteCode: string): Promise<Squad> {
  await requireLive(creatorId);
  if (await activeMembership(creatorId)) {
    throw new AppError(400, "You're already in a squad — leave it first");
  }

  const { rows } = await pool.query<SquadRow & { active_member_count: string }>(
    `SELECT s.id, s.name, s.invite_code, count(sm.id) AS active_member_count
     FROM squads s
     LEFT JOIN squad_members sm ON sm.squad_id = s.id AND sm.left_at IS NULL
     WHERE s.invite_code = $1 AND s.status = 'active'
     GROUP BY s.id`,
    [inviteCode.toUpperCase()]
  );
  const squad = rows[0];
  if (!squad) throw new AppError(404, "Invalid or expired squad invite code");
  if (Number(squad.active_member_count) >= MAX_SQUAD_SIZE) {
    throw new AppError(400, `This squad is full (max ${MAX_SQUAD_SIZE})`);
  }

  await pool.query(`INSERT INTO squad_members (squad_id, creator_id) VALUES ($1, $2)`, [squad.id, creatorId]);
  return buildSquad(squad, creatorId);
}

export async function leaveSquad(creatorId: string): Promise<void> {
  const membership = await activeMembership(creatorId);
  if (!membership) throw new AppError(400, "You're not currently in a squad");

  await pool.query(`UPDATE squad_members SET left_at = now() WHERE squad_id = $1 AND creator_id = $2`, [
    membership.squad_id,
    creatorId,
  ]);

  const { rows: remaining } = await pool.query(
    `SELECT 1 FROM squad_members WHERE squad_id = $1 AND left_at IS NULL`,
    [membership.squad_id]
  );
  if (remaining.length === 0) {
    await pool.query(`UPDATE squads SET status = 'ended', ended_at = now() WHERE id = $1`, [membership.squad_id]);
  }
}

export async function getMySquad(creatorId: string): Promise<Squad | null> {
  const membership = await activeMembership(creatorId);
  if (!membership) return null;
  const { rows } = await pool.query<SquadRow>(`SELECT id, name, invite_code FROM squads WHERE id = $1`, [
    membership.squad_id,
  ]);
  const squad = rows[0];
  if (!squad) return null;
  return buildSquad(squad, creatorId);
}

// Public — the watch page's squad grid. Resolves by username (not
// creatorId) since that's what the page already has; returns null both
// when the creator has no active squad and when the username doesn't
// exist, same "don't distinguish" posture as other public lookups here.
export async function getSquadForUsername(username: string, viewerId?: string): Promise<Squad | null> {
  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  const userId = userRows[0]?.id;
  if (!userId) return null;

  const membership = await activeMembership(userId);
  if (!membership) return null;
  const { rows } = await pool.query<SquadRow>(`SELECT id, name, invite_code FROM squads WHERE id = $1`, [
    membership.squad_id,
  ]);
  const squad = rows[0];
  if (!squad) return null;
  return buildSquad(squad, viewerId);
}
