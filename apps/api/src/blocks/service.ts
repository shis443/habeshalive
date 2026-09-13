import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

// A viewer permanently opting out of a creator — deliberately separate
// from channel_blocks (0036_channel_mods_and_multiscript.sql), which is
// the opposite direction: a creator/moderator blocking a viewer from
// their own channel. This is the consumer-facing "I never want to see
// this creator again" action from the Explore feed's 3-dot menu.
//
// Blocking implies unfollowing — a blocked creator's live streams are
// also excluded from listLiveStreams (streams/service.ts's
// streamSelectColumns/listLiveStreams), so staying "followed" while
// blocked would be an inconsistent, unreachable state (followed but
// never shown).
export async function blockCreator(blockerId: string, creatorId: string): Promise<void> {
  if (blockerId === creatorId) throw new AppError(400, "You can't block yourself");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO creator_blocks (blocker_id, creator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, creatorId]
    );
    await client.query(`DELETE FROM follows WHERE follower_id = $1 AND creator_id = $2`, [
      blockerId,
      creatorId,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Not wired to any UI yet (no unblock affordance requested) — kept
// alongside blockCreator so the relationship is reversible from day one,
// same reasoning as every other toggleable relationship in this codebase
// (follows, category follows).
export async function unblockCreator(blockerId: string, creatorId: string): Promise<void> {
  await pool.query(`DELETE FROM creator_blocks WHERE blocker_id = $1 AND creator_id = $2`, [
    blockerId,
    creatorId,
  ]);
}

export async function getBlockStatus(blockerId: string, creatorId: string): Promise<{ blocked: boolean }> {
  const { rows } = await pool.query(`SELECT 1 FROM creator_blocks WHERE blocker_id = $1 AND creator_id = $2`, [
    blockerId,
    creatorId,
  ]);
  return { blocked: rows.length > 0 };
}
