import type {
  ChapaTransferWebhook,
  ChapaWebhook,
  CreatorPayoutContext,
  EarningsThisMonth,
  GiftAlert,
  GiftType,
  PayoutHistoryItem,
  PayoutQueueItem,
  PayoutResponse,
  RequestPayoutInput,
  SendGiftInput,
  Transaction,
  TopupResponse,
  WalletBalance,
} from "@habeshalive/shared";
import { randomUUID } from "node:crypto";
import { logAdminAction } from "../admin/audit.js";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { flagIfMatched } from "../moderation/service.js";
import { chapaClient, chapaPayoutClient } from "./chapa-client.js";

function channelForGiftAlerts(streamId: string): string {
  // Mirrors chat/service.ts's channelForStream: same Centrifugo instance,
  // separate namespace (see infra/centrifugo/config.json) so overlay/alert
  // widgets can subscribe without also receiving chat traffic.
  return `gift-alerts:${streamId}`;
}

// Best-effort fan-out, same philosophy as chat/service.ts's
// publishToCentrifugo: the gift is already durably recorded in gifts_sent
// and the ledger by the time this runs, so a publish failure here only
// costs the live on-stream alert, not the money movement.
async function publishGiftAlert(alert: GiftAlert): Promise<void> {
  const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
    method: "POST",
    headers: {
      "X-API-Key": env.CENTRIFUGO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "publish",
      params: { channel: channelForGiftAlerts(alert.streamId), data: alert },
    }),
  });
  if (!res.ok) {
    console.error(`[wallet] Centrifugo gift-alert publish failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

const PAYOUT_MANUAL_REVIEW_THRESHOLD_SANTIM = 500_000; // 5,000 ETB

export async function listGiftTypes(): Promise<GiftType[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    price_santim: number;
    animation_key: string;
  }>(`SELECT id, name, price_santim, animation_key FROM gift_types WHERE is_active = TRUE ORDER BY price_santim ASC`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceSantim: row.price_santim,
    animationKey: row.animation_key,
  }));
}

export async function getBalance(userId: string): Promise<WalletBalance> {
  const walletId = await getUserWalletId(pool, userId);

  const { rows } = await pool.query<{ balance_santim: number; updated_at: string }>(
    `SELECT balance_santim, updated_at FROM wallet_balances_cache WHERE wallet_id = $1`,
    [walletId]
  );
  const row = rows[0];

  const { rows: deltaRows } = await pool.query<{ delta: number }>(
    `SELECT COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_santim ELSE -le.amount_santim END), 0)::bigint AS delta
     FROM ledger_entries le
     JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
     WHERE le.wallet_id = $1 AND lt.status = 'completed' AND lt.created_at >= now() - interval '7 days'`,
    [walletId]
  );

  return {
    balanceSantim: row?.balance_santim ?? 0,
    weeklyDeltaSantim: deltaRows[0]?.delta ?? 0,
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

export async function getEarningsThisMonth(userId: string): Promise<EarningsThisMonth> {
  const walletId = await getUserWalletId(pool, userId);
  const { rows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(le.amount_santim), 0)::bigint AS total
     FROM ledger_entries le
     JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
     WHERE le.wallet_id = $1
       AND le.direction = 'credit'
       AND lt.type IN ('gift', 'subscription')
       AND lt.status = 'completed'
       AND lt.created_at >= date_trunc('month', now())`,
    [walletId]
  );
  return { amountSantim: rows[0]?.total ?? 0 };
}

export async function initiateTopup(userId: string, amountSantim: number): Promise<TopupResponse> {
  const reference = `topup_${randomUUID()}`;

  const { rows: userRows } = await pool.query<{ email: string | null; display_name: string }>(
    `SELECT email, display_name FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRows[0];
  if (!user) throw new AppError(404, "User not found");
  const [firstName, ...rest] = user.display_name.split(" ");
  // Chapa requires an email; not every account has one (phone-first auth is
  // the norm here). A synthetic, non-routable placeholder satisfies Chapa's
  // schema without implying we can actually email this address.
  const email = user.email ?? `${userId}@users.birq.invalid`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const walletId = await getUserWalletId(client, userId);
    const platformWalletId = await getPlatformWalletId(client);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, reference, status) VALUES ('topup', $1, 'pending') RETURNING id`,
      [reference]
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, walletId, "credit", amountSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", amountSantim);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { checkoutUrl } = await chapaClient.initializeCheckout(amountSantim, reference, {
    email,
    firstName: firstName || "Birq",
    lastName: rest.join(" ") || "User",
  });
  return { reference, checkoutUrl };
}

export async function completeTopupFromWebhook(webhook: ChapaWebhook): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM ledger_transactions WHERE reference = $1 AND type = 'topup' FOR UPDATE`,
      [webhook.tx_ref]
    );
    const transaction = rows[0];
    if (!transaction) throw new AppError(404, "Unknown top-up reference");

    if (transaction.status !== "pending") {
      // Already processed — idempotent no-op so Chapa can safely retry.
      await client.query("COMMIT");
      return;
    }

    const isSuccess = webhook.status.toLowerCase() === "success";
    const newStatus = isSuccess ? "completed" : "failed";

    const updated = await client.query<{ id: string }>(
      `UPDATE ledger_transactions SET status = $1, completed_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING id`,
      [newStatus, transaction.id]
    );

    if (!updated.rows[0]) {
      // Lost the race to a concurrent webhook delivery — already handled.
      await client.query("COMMIT");
      return;
    }

    if (isSuccess) {
      const { rows: entries } = await client.query<{
        wallet_id: string;
        direction: "debit" | "credit";
        amount_santim: number;
      }>(`SELECT wallet_id, direction, amount_santim FROM ledger_entries WHERE ledger_transaction_id = $1`, [
        transaction.id,
      ]);
      for (const entry of entries) {
        const delta = entry.direction === "credit" ? entry.amount_santim : -entry.amount_santim;
        await applyBalanceDelta(client, entry.wallet_id, delta);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function sendGift(senderId: string, input: SendGiftInput): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const giftTypeResult = await client.query<{ price_santim: number; is_active: boolean }>(
      `SELECT price_santim, is_active FROM gift_types WHERE id = $1`,
      [input.giftTypeId]
    );
    const giftType = giftTypeResult.rows[0];
    if (!giftType || !giftType.is_active) throw new AppError(404, "Gift type not found");

    const streamResult = await client.query<{ creator_id: string }>(
      `SELECT creator_id FROM streams WHERE id = $1`,
      [input.streamId]
    );
    const stream = streamResult.rows[0];
    if (!stream) throw new AppError(404, "Stream not found");
    if (stream.creator_id === senderId) throw new AppError(400, "You can't gift your own stream");

    const profileResult = await client.query<{ revenue_share_bps: number }>(
      `SELECT revenue_share_bps FROM creator_profiles WHERE user_id = $1`,
      [stream.creator_id]
    );
    const profile = profileResult.rows[0];
    if (!profile) throw new AppError(404, "Creator has no payout profile");

    const totalAmount = giftType.price_santim * input.quantity;

    const senderWalletId = await getUserWalletId(client, senderId);
    const creatorWalletId = await getUserWalletId(client, stream.creator_id);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [senderWalletId]
    );
    const senderBalance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (senderBalance < totalAmount) throw new AppError(400, "Insufficient balance");

    const creatorShare = Math.trunc((totalAmount * profile.revenue_share_bps) / 10_000);
    const platformShare = totalAmount - creatorShare;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, stream_id, status, completed_at)
       VALUES ('gift', $1, 'completed', now()) RETURNING id`,
      [input.streamId]
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, senderWalletId, "debit", totalAmount);
    await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

    await applyBalanceDelta(client, senderWalletId, -totalAmount);
    await applyBalanceDelta(client, creatorWalletId, creatorShare);
    await applyBalanceDelta(client, platformWalletId, platformShare);

    await client.query(
      `INSERT INTO gifts_sent (ledger_transaction_id, sender_id, creator_id, stream_id, gift_type_id, quantity, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ledgerTransactionId,
        senderId,
        stream.creator_id,
        input.streamId,
        input.giftTypeId,
        input.quantity,
        input.message ?? null,
      ]
    );

    await client.query("COMMIT");

    if (input.message) {
      await flagIfMatched("gift_message", ledgerTransactionId, senderId, input.message);
    }

    const { rows: alertRows } = await pool.query<{
      username: string;
      display_name: string;
      gift_name: string;
      animation_key: string;
    }>(
      `SELECT u.username, u.display_name, gt.name AS gift_name, gt.animation_key
       FROM users u, gift_types gt
       WHERE u.id = $1 AND gt.id = $2`,
      [senderId, input.giftTypeId]
    );
    const alertInfo = alertRows[0];
    if (alertInfo) {
      await publishGiftAlert({
        id: ledgerTransactionId,
        streamId: input.streamId,
        senderId,
        senderUsername: alertInfo.username,
        senderDisplayName: alertInfo.display_name,
        giftTypeId: input.giftTypeId,
        giftName: alertInfo.gift_name,
        animationKey: alertInfo.animation_key,
        quantity: input.quantity,
        totalSantim: totalAmount,
        message: input.message ?? null,
        createdAt: new Date().toISOString(),
      });
    }

    return { id: ledgerTransactionId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Chapa's own bank directory doesn't have a stable, documented code for
// Telebirr — resolved by name lookup against GET /v1/banks instead of
// hardcoding a guessed value (see chapa-client.ts's resolveBankCodeByName
// doc comment for why guessing here would be dangerous).
const TELEBIRR_BANK_NAME_FRAGMENT = "telebirr";

// Reverses a completed payout's ledger effect (credits the creator back,
// debits the platform back) as a new 'refund'-type transaction — the
// original 'payout' transaction is left as-is (immutable history), this
// just adds the offsetting entries. Used when disbursement fails after the
// funds were already reserved.
async function reversePayoutLedger(
  client: import("pg").PoolClient,
  creatorId: string,
  amountSantim: number
): Promise<void> {
  const creatorWalletId = await getUserWalletId(client, creatorId);
  const platformWalletId = await getPlatformWalletId(client);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('refund', 'completed', now()) RETURNING id`
  );
  const reversalId = rows[0]!.id;

  await insertEntry(client, reversalId, creatorWalletId, "credit", amountSantim);
  await insertEntry(client, reversalId, platformWalletId, "debit", amountSantim);
  await applyBalanceDelta(client, creatorWalletId, amountSantim);
  await applyBalanceDelta(client, platformWalletId, -amountSantim);
}

export async function requestPayout(
  creatorId: string,
  input: RequestPayoutInput
): Promise<PayoutResponse> {
  const { rows: userRows } = await pool.query<{ display_name: string; is_suspended: boolean }>(
    `SELECT display_name, is_suspended FROM users WHERE id = $1`,
    [creatorId]
  );
  if (userRows[0]?.is_suspended) throw new AppError(403, "Your payout privileges are currently suspended");
  const displayName = userRows[0]?.display_name ?? "Birq Creator";

  const bankCode =
    input.method === "telebirr"
      ? await chapaPayoutClient.resolveBankCodeByName(TELEBIRR_BANK_NAME_FRAGMENT)
      : input.bankCode!; // schema's .refine() guarantees this for "bank"

  let payoutId!: string;
  let status!: "pending_review" | "processing";
  const requiresManualApproval = input.amountSantim >= PAYOUT_MANUAL_REVIEW_THRESHOLD_SANTIM;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const creatorWalletId = await getUserWalletId(client, creatorId);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [creatorWalletId]
    );
    const balance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (balance < input.amountSantim) throw new AppError(400, "Insufficient balance");

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('payout', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, creatorWalletId, "debit", input.amountSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", input.amountSantim);

    await applyBalanceDelta(client, creatorWalletId, -input.amountSantim);
    await applyBalanceDelta(client, platformWalletId, input.amountSantim);

    status = requiresManualApproval ? "pending_review" : "processing";

    const payoutResult = await client.query<{ id: string }>(
      `INSERT INTO payouts (ledger_transaction_id, creator_id, amount_santim, method, destination, bank_code, status, requires_manual_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        ledgerTransactionId,
        creatorId,
        input.amountSantim,
        input.method,
        input.destination,
        bankCode,
        status,
        requiresManualApproval,
      ]
    );
    payoutId = payoutResult.rows[0]!.id;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Below the manual-review threshold: attempt disbursement immediately.
  // Funds are already reserved (debited above) — a failed transfer here
  // must reverse that, not leave the creator's balance silently short.
  if (status === "processing") {
    try {
      const { chapaReference } = await chapaPayoutClient.initiateTransfer({
        accountNumber: input.destination,
        accountName: displayName,
        amountSantim: input.amountSantim,
        bankCode,
        reference: payoutId,
      });
      await pool.query(`UPDATE payouts SET chapa_reference = $1 WHERE id = $2`, [chapaReference, payoutId]);
    } catch (err) {
      const reverseClient = await pool.connect();
      try {
        await reverseClient.query("BEGIN");
        await reversePayoutLedger(reverseClient, creatorId, input.amountSantim);
        await reverseClient.query(
          `UPDATE payouts SET status = 'failed', failure_reason = $1 WHERE id = $2`,
          [err instanceof Error ? err.message : "Transfer initiation failed", payoutId]
        );
        await reverseClient.query("COMMIT");
      } catch (reverseErr) {
        await reverseClient.query("ROLLBACK");
        throw reverseErr;
      } finally {
        reverseClient.release();
      }
      throw new AppError(502, "Payout transfer could not be started — your balance was refunded");
    }
  }

  return { id: payoutId, amountSantim: input.amountSantim, status, requiresManualApproval };
}

interface PayoutQueueRow {
  id: string;
  creator_id: string;
  creator_username: string;
  amount_santim: number;
  method: PayoutQueueItem["method"];
  destination: string;
  status: PayoutQueueItem["status"];
  created_at: string;
}

export async function listPendingPayouts(limit = 50): Promise<PayoutQueueItem[]> {
  const { rows } = await pool.query<PayoutQueueRow>(
    `SELECT p.id, p.creator_id, u.username AS creator_username, p.amount_santim, p.method,
            p.destination, p.status, p.created_at
     FROM payouts p
     JOIN users u ON u.id = p.creator_id
     WHERE p.status = 'pending_review'
     ORDER BY p.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    amountSantim: row.amount_santim,
    method: row.method,
    destination: row.destination,
    status: row.status,
    createdAt: row.created_at,
  }));
}

interface PayoutHistoryRow {
  id: string;
  creator_id: string;
  creator_username: string;
  amount_santim: number;
  method: PayoutQueueItem["method"];
  destination: string;
  status: PayoutHistoryItem["status"];
  failure_reason: string | null;
  approved_by_username: string | null;
  rejected_by_username: string | null;
  created_at: string;
  paid_at: string | null;
}

// For support/dispute lookups — every payout regardless of status, not
// just the live pending_review queue listPendingPayouts serves.
export async function listAllPayouts(filters: {
  status?: PayoutHistoryItem["status"];
  creatorUsername?: string;
  limit?: number;
}): Promise<PayoutHistoryItem[]> {
  const { rows } = await pool.query<PayoutHistoryRow>(
    `SELECT p.id, p.creator_id, u.username AS creator_username, p.amount_santim, p.method, p.destination,
            p.status, p.failure_reason, au.username AS approved_by_username, ru.username AS rejected_by_username,
            p.created_at, p.paid_at
     FROM payouts p
     JOIN users u ON u.id = p.creator_id
     LEFT JOIN users au ON au.id = p.approved_by
     LEFT JOIN users ru ON ru.id = p.rejected_by
     WHERE ($1::text IS NULL OR p.status = $1)
       AND ($2::text IS NULL OR u.username ILIKE '%' || $2 || '%')
     ORDER BY p.created_at DESC
     LIMIT $3`,
    [filters.status ?? null, filters.creatorUsername ?? null, filters.limit ?? 100]
  );
  return rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    amountSantim: row.amount_santim,
    method: row.method,
    destination: row.destination,
    status: row.status,
    failureReason: row.failure_reason,
    approvedByUsername: row.approved_by_username,
    rejectedByUsername: row.rejected_by_username,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}

// The context an admin should see before approving/rejecting a payout
// blind — lifetime payout total, how old the account is, any moderation
// flags against them.
export async function getCreatorPayoutContext(creatorId: string): Promise<CreatorPayoutContext> {
  const [totals, account, flags] = await Promise.all([
    pool.query<{ total: string | null }>(
      `SELECT sum(amount_santim)::text AS total FROM payouts WHERE creator_id = $1 AND status = 'paid'`,
      [creatorId]
    ),
    pool.query<{ created_at: string }>(`SELECT created_at FROM users WHERE id = $1`, [creatorId]),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM moderation_flags WHERE author_id = $1 AND status = 'pending'`,
      [creatorId]
    ),
  ]);
  return {
    totalLifetimePayoutsSantim: Number(totals.rows[0]?.total ?? 0),
    accountCreatedAt: account.rows[0]?.created_at ?? new Date().toISOString(),
    pendingModerationFlags: Number(flags.rows[0]?.count ?? 0),
  };
}

export async function approvePayout(payoutId: string, adminUserId: string): Promise<void> {
  const client = await pool.connect();
  let creatorId!: string;
  let amountSantim!: number;
  let destination!: string;
  let bankCode!: string | null;

  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      creator_id: string;
      amount_santim: number;
      destination: string;
      bank_code: string | null;
      status: string;
    }>(`SELECT creator_id, amount_santim, destination, bank_code, status FROM payouts WHERE id = $1 FOR UPDATE`, [
      payoutId,
    ]);
    const payout = rows[0];
    if (!payout) throw new AppError(404, "Payout not found");
    if (payout.status !== "pending_review") throw new AppError(400, "Payout is not awaiting review");

    creatorId = payout.creator_id;
    amountSantim = payout.amount_santim;
    destination = payout.destination;
    bankCode = payout.bank_code;

    await client.query(`UPDATE payouts SET approved_by = $1 WHERE id = $2`, [adminUserId, payoutId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { rows: userRows } = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [creatorId]
  );
  const displayName = userRows[0]?.display_name ?? "Birq Creator";

  try {
    const { chapaReference } = await chapaPayoutClient.initiateTransfer({
      accountNumber: destination,
      accountName: displayName,
      amountSantim,
      bankCode: bankCode!,
      reference: payoutId,
    });
    await pool.query(`UPDATE payouts SET status = 'processing', chapa_reference = $1 WHERE id = $2`, [
      chapaReference,
      payoutId,
    ]);
    await logAdminAction(adminUserId, "payout.approve", "payout", payoutId, {
      metadata: { creatorId, amountSantim },
    });
  } catch (err) {
    const reverseClient = await pool.connect();
    try {
      await reverseClient.query("BEGIN");
      await reversePayoutLedger(reverseClient, creatorId, amountSantim);
      await reverseClient.query(`UPDATE payouts SET status = 'failed', failure_reason = $1 WHERE id = $2`, [
        err instanceof Error ? err.message : "Transfer initiation failed",
        payoutId,
      ]);
      await reverseClient.query("COMMIT");
    } catch (reverseErr) {
      await reverseClient.query("ROLLBACK");
      throw reverseErr;
    } finally {
      reverseClient.release();
    }
    throw new AppError(502, "Payout transfer could not be started — the creator's balance was refunded");
  }
}

// Reverses the reservation requestPayout() made at request time (the
// creator's balance was already debited then, regardless of manual-review
// status) — a rejection must refund it, not just flip a status flag. The
// reason is stored in the same failure_reason column completePayoutFromWebhook
// already uses for an automatic failure, since both answer the same
// question ("why didn't this get paid") for whoever's looking at the row.
export async function rejectPayout(payoutId: string, adminUserId: string, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ creator_id: string; amount_santim: number; status: string }>(
      `SELECT creator_id, amount_santim, status FROM payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    const payout = rows[0];
    if (!payout) throw new AppError(404, "Payout not found");
    if (payout.status !== "pending_review") throw new AppError(400, "Payout is not awaiting review");

    await reversePayoutLedger(client, payout.creator_id, payout.amount_santim);
    await client.query(
      `UPDATE payouts SET status = 'failed', failure_reason = $1, rejected_by = $2 WHERE id = $3`,
      [reason, adminUserId, payoutId]
    );
    await logAdminAction(adminUserId, "payout.reject", "payout", payoutId, {
      reason,
      metadata: { creatorId: payout.creator_id, amountSantim: payout.amount_santim },
      client,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function completePayoutFromWebhook(webhook: ChapaTransferWebhook): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: string; creator_id: string; amount_santim: number; status: string }>(
      `SELECT id, creator_id, amount_santim, status FROM payouts WHERE id = $1 FOR UPDATE`,
      [webhook.reference]
    );
    const payout = rows[0];
    if (!payout) throw new AppError(404, "Unknown payout reference");

    if (payout.status === "paid" || payout.status === "failed") {
      // Already processed — idempotent no-op so Chapa can safely retry.
      await client.query("COMMIT");
      return;
    }

    const isSuccess = webhook.status.toLowerCase() === "success";

    if (isSuccess) {
      await client.query(`UPDATE payouts SET status = 'paid', paid_at = now() WHERE id = $1`, [payout.id]);
    } else {
      await reversePayoutLedger(client, payout.creator_id, payout.amount_santim);
      await client.query(`UPDATE payouts SET status = 'failed', failure_reason = $1 WHERE id = $2`, [
        `Chapa reported transfer status: ${webhook.status}`,
        payout.id,
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface TransactionRow {
  id: string;
  type: Transaction["type"];
  status: Transaction["status"];
  created_at: string;
  direction: "debit" | "credit";
  amount_santim: number;
  sender_display_name: string | null;
  creator_display_name: string | null;
  gift_name: string | null;
  payout_method: string | null;
  sub_subscriber_name: string | null;
  sub_creator_name: string | null;
  sub_tier_name: string | null;
}

function buildTransactionTitle(row: TransactionRow): string {
  if (row.type === "gift") {
    const gift = row.gift_name ?? "a gift";
    if (row.direction === "debit") return `Sent ${gift} to ${row.creator_display_name ?? "creator"}`;
    return `Received ${gift} from ${row.sender_display_name ?? "a viewer"}`;
  }
  if (row.type === "subscription") {
    const tier = row.sub_tier_name ?? "a tier";
    if (row.direction === "debit") return `Subscribed to ${row.sub_creator_name ?? "creator"} (${tier})`;
    return `New subscriber: ${row.sub_subscriber_name ?? "a viewer"} (${tier})`;
  }
  if (row.type === "payout") {
    const method = row.payout_method === "bank" ? "bank account" : "Telebirr";
    return `Withdrew to ${method}`;
  }
  if (row.type === "topup") return "Added funds via Chapa";
  if (row.type === "refund") return "Refund";
  if (row.type === "boost") return row.direction === "debit" ? "Boosted your stream" : "Stream boost revenue";
  return "Balance adjustment";
}

export async function listTransactions(userId: string, limit = 50): Promise<Transaction[]> {
  const walletId = await getUserWalletId(pool, userId);

  const { rows } = await pool.query<TransactionRow>(
    `SELECT lt.id, lt.type, lt.status, lt.created_at, le.direction, le.amount_santim,
            sender_u.display_name AS sender_display_name,
            creator_u.display_name AS creator_display_name,
            gt.name AS gift_name,
            p.method AS payout_method,
            sub_subscriber_u.display_name AS sub_subscriber_name,
            sub_creator_u.display_name AS sub_creator_name,
            st.name AS sub_tier_name
     FROM ledger_entries le
     JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
     LEFT JOIN gifts_sent gs ON gs.ledger_transaction_id = lt.id
     LEFT JOIN users sender_u ON sender_u.id = gs.sender_id
     LEFT JOIN users creator_u ON creator_u.id = gs.creator_id
     LEFT JOIN gift_types gt ON gt.id = gs.gift_type_id
     LEFT JOIN payouts p ON p.ledger_transaction_id = lt.id
     LEFT JOIN subscriptions sub ON sub.ledger_transaction_id = lt.id
     LEFT JOIN users sub_subscriber_u ON sub_subscriber_u.id = sub.subscriber_id
     LEFT JOIN users sub_creator_u ON sub_creator_u.id = sub.creator_id
     LEFT JOIN subscription_tiers st ON st.id = sub.tier_id
     WHERE le.wallet_id = $1
     ORDER BY lt.created_at DESC
     LIMIT $2`,
    [walletId, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    title: buildTransactionTitle(row),
    amountSantim: row.amount_santim,
    direction: row.direction,
    createdAt: row.created_at,
  }));
}
