import {
  DAILY_POINT_CAP,
  POINTS_PER_HEARTBEAT,
  POINTS_PER_SANTIM,
  type RedeemPointsResponse,
  type WatchHeartbeatResponse,
} from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

// Module 4 — Watch-to-Earn. Points are minted by watching, not
// transferred between two parties, so viewer_points/point_transactions
// (db/migrations/0035_clips_and_points.sql) are a simple balance +
// append-only log, not a double-entry wallet ledger — that only happens
// at redemption, where real ETB does move (platform wallet -> viewer
// wallet, same shape as a top-up).

export async function getPointsBalance(userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: number }>(`SELECT balance FROM viewer_points WHERE user_id = $1`, [
    userId,
  ]);
  return rows[0]?.balance ?? 0;
}

// DAILY_POINT_CAP is the real anti-farming control — bounds total
// possible award regardless of how fast a client calls this, so a
// scripted client spamming heartbeats faster than
// HEARTBEAT_INTERVAL_SECONDS just hits the cap sooner, never earns more
// than a genuine viewer watching all day would. The route-level rate
// limit (vods/routes... see points/routes.ts) is defense-in-depth for
// server load, not the thing actually preventing overpayment.
export async function recordWatchHeartbeat(userId: string, streamId: string): Promise<WatchHeartbeatResponse> {
  const { rows: streamRows } = await pool.query(`SELECT 1 FROM streams WHERE id = $1 AND status = 'live'`, [
    streamId,
  ]);
  if (!streamRows[0]) throw new AppError(400, "That stream isn't live");

  const { rows: dayRows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(delta), 0)::text AS total FROM point_transactions
     WHERE user_id = $1 AND reason = 'watch_heartbeat' AND created_at >= date_trunc('day', now())`,
    [userId]
  );
  const earnedToday = Number(dayRows[0]!.total);

  if (earnedToday >= DAILY_POINT_CAP) {
    return { awarded: 0, balance: await getPointsBalance(userId), dailyCapReached: true };
  }

  const award = Math.min(POINTS_PER_HEARTBEAT, DAILY_POINT_CAP - earnedToday);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO viewer_points (user_id, balance) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = viewer_points.balance + $2, updated_at = now()`,
      [userId, award]
    );
    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason, stream_id) VALUES ($1, $2, 'watch_heartbeat', $3)`,
      [userId, award, streamId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    awarded: award,
    balance: await getPointsBalance(userId),
    dailyCapReached: earnedToday + award >= DAILY_POINT_CAP,
  };
}

// "Redeem for airtime" from the original spec isn't implemented — no
// real telecom carrier API partnership exists to actually top up a
// phone (same reasoning as Module 2's Telebirr/CBE Birr not getting a
// fake client). This credits real wallet balance instead: same
// money-enters-the-system ledger shape as a Chapa top-up (credit viewer
// wallet, debit platform wallet), since Birq itself is the one paying
// out real ETB for engagement here.
export async function redeemPoints(userId: string, points: number): Promise<RedeemPointsResponse> {
  const creditedSantim = Math.floor(points / POINTS_PER_SANTIM);
  if (creditedSantim <= 0) throw new AppError(400, `Redeem at least ${POINTS_PER_SANTIM} points`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ balance: number }>(
      `SELECT balance FROM viewer_points WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const balance = rows[0]?.balance ?? 0;
    if (balance < points) throw new AppError(400, "Insufficient points");

    await client.query(`UPDATE viewer_points SET balance = balance - $1, updated_at = now() WHERE user_id = $2`, [
      points,
      userId,
    ]);
    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, 'redeemed_for_wallet_credit')`,
      [userId, -points]
    );

    const walletId = await getUserWalletId(client, userId);
    const platformWalletId = await getPlatformWalletId(client);
    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('points_redemption', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = txRows[0]!.id;
    await insertEntry(client, ledgerTransactionId, walletId, "credit", creditedSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", creditedSantim);
    await applyBalanceDelta(client, walletId, creditedSantim);
    await applyBalanceDelta(client, platformWalletId, -creditedSantim);

    await client.query("COMMIT");
    return { balance: balance - points, creditedSantim };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
