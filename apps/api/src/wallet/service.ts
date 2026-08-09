import type {
  ChapaTransferWebhook,
  ChapaWebhook,
  CreatorPayoutContext,
  DonateInput,
  DonateResponse,
  EarningsThisMonth,
  GifterBadge,
  GifterBadgeTier,
  GiftTier,
  GiftTierKey,
  GiftType,
  PayoutHistoryItem,
  PayoutQueueItem,
  PayoutResponse,
  Rank,
  RequestPayoutInput,
  SendGiftInput,
  SendGiftResponse,
  StreamAlert,
  Transaction,
  TopupResponse,
  UserRank,
  WalletBalance,
} from "@birq/shared";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { logAdminAction } from "../admin/audit.js";
import { getKycRequiredForPayouts, getPayoutManualReviewThreshold } from "../admin/config-service.js";
import { hasApprovedKyc } from "../kyc/service.js";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { getActiveSecurityHold } from "../common/security-hold.js";
import { flagIfMatched } from "../moderation/service.js";
import { notify } from "../notifications/service.js";
import { chapaClient, chapaPayoutClient } from "./chapa-client.js";
import {
  isTemporalConfigured,
  signalApprove,
  signalChapaTransferOutcome,
  signalReject,
  startPayoutWorkflow,
} from "./temporal/client.js";

function channelForGiftAlerts(streamId: string): string {
  // Mirrors chat/service.ts's channelForStream: same Centrifugo instance,
  // separate namespace (see infra/centrifugo/config.json) so overlay/alert
  // widgets can subscribe without also receiving chat traffic.
  return `gift-alerts:${streamId}`;
}

// Best-effort fan-out, same philosophy as chat/service.ts's
// publishToCentrifugo: the gift/donation is already durably recorded
// (gifts_sent/donations) and the ledger by the time this runs, so a
// publish failure here only costs the live on-stream alert, not the
// money movement. One channel for both alert kinds (see StreamAlert's
// own comment) — a stream's overlay only needs to subscribe once.
async function publishStreamAlert(alert: StreamAlert): Promise<void> {
  // Whole fetch wrapped, not just the !res.ok branch — a network-level
  // failure (Centrifugo unreachable) throws out of a bare fetch() before
  // there's a response to check, which the comment above ("a publish
  // failure here only costs the live alert") didn't actually hold for
  // until this fix — sendGift() awaits this after the money movement is
  // already committed, so an uncaught throw here would have reported a
  // real, already-successful gift send as a failure to the client. Same
  // class of bug fixed the same way in chat/service.ts, streams/service.ts,
  // and notifications/service.ts — found by running the new money-path
  // tests locally without Centrifugo running.
  try {
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
  } catch (err) {
    console.error(`[wallet] Centrifugo gift-alert publish request failed:`, err);
  }
}

// Gifter badge tiers — cumulative Gursha value sent to ONE creator, same
// "top gifter to this channel" scoping as Twitch's bit badges, not a
// platform-wide leaderboard. Thresholds are santim (25 ETB = 1 Gursha at
// the current base price from db/migrations/0019_gursha.sql).
const BADGE_TIER_THRESHOLDS: { tier: GifterBadgeTier; thresholdSantim: number }[] = [
  { tier: "platinum", thresholdSantim: 625_000 }, // 6,250 ETB / 250 Gursha
  { tier: "gold", thresholdSantim: 125_000 }, //   1,250 ETB / 50 Gursha
  { tier: "silver", thresholdSantim: 25_000 }, //    250 ETB / 10 Gursha
  { tier: "bronze", thresholdSantim: 2_500 }, //      25 ETB / 1 Gursha
];

function tierForTotal(totalSantim: number): GifterBadgeTier {
  for (const { tier, thresholdSantim } of BADGE_TIER_THRESHOLDS) {
    if (totalSantim >= thresholdSantim) return tier;
  }
  return "none";
}

function nextTierThreshold(tier: GifterBadgeTier): number | null {
  const currentIndex = BADGE_TIER_THRESHOLDS.findIndex((t) => t.tier === tier);
  // currentIndex === -1 means tier is "none" — next is the lowest tier,
  // the last entry in the descending-order array above.
  const nextIndex = currentIndex === -1 ? BADGE_TIER_THRESHOLDS.length - 1 : currentIndex - 1;
  return BADGE_TIER_THRESHOLDS[nextIndex]?.thresholdSantim ?? null;
}

export async function getGifterBadge(userId: string, creatorId: string): Promise<GifterBadge> {
  const { rows } = await pool.query<{ total_gursha_santim: number; tier: GifterBadgeTier }>(
    `SELECT total_gursha_santim, tier FROM gifter_badges WHERE user_id = $1 AND creator_id = $2`,
    [userId, creatorId]
  );
  const row = rows[0];
  const tier = row?.tier ?? "none";
  return {
    creatorId,
    totalGurshaSantim: row?.total_gursha_santim ?? 0,
    tier,
    nextTierThresholdSantim: nextTierThreshold(tier),
  };
}

// Called inside sendGift()'s transaction — the badge update is part of the
// same atomic unit as the money movement, not a best-effort side effect.
async function upsertGifterBadge(
  client: PoolClient,
  userId: string,
  creatorId: string,
  addedSantim: number
): Promise<GifterBadge> {
  const { rows } = await client.query<{ total_gursha_santim: number }>(
    `INSERT INTO gifter_badges (user_id, creator_id, total_gursha_santim, tier)
     VALUES ($1, $2, $3, 'none')
     ON CONFLICT (user_id, creator_id) DO UPDATE
       SET total_gursha_santim = gifter_badges.total_gursha_santim + $3, updated_at = now()
     RETURNING total_gursha_santim`,
    [userId, creatorId, addedSantim]
  );
  const total = rows[0]!.total_gursha_santim;
  const tier = tierForTotal(total);
  await client.query(`UPDATE gifter_badges SET tier = $1 WHERE user_id = $2 AND creator_id = $3`, [
    tier,
    userId,
    creatorId,
  ]);
  return { creatorId, totalGurshaSantim: total, tier, nextTierThresholdSantim: nextTierThreshold(tier) };
}

interface GiftTypeRow {
  id: string;
  name: string;
  price_santim: number;
  animation_key: string;
  tier_key: GiftTierKey;
}

// Platform-wide Rank — cumulative Gursha spend across every creator, NOT
// scoped to one like gifter_badges/BADGE_TIER_THRESHOLDS above. Named
// after historical Ethiopian military/administrative titles (see
// db/migrations/0025_gursha_gift_economy.sql for the design rationale).
// Same descending-array-with-fallback pattern as BADGE_TIER_THRESHOLDS.
const RANK_THRESHOLDS: { rank: Rank; thresholdSantim: number }[] = [
  { rank: "dejazmach", thresholdSantim: 10_000_000 }, // 100,000+ ETB
  { rank: "shi_aleka", thresholdSantim: 5_000_000 }, //   50,000 ETB
  { rank: "meto_aleka", thresholdSantim: 1_000_000 }, //  10,000 ETB
  { rank: "asir_aleka", thresholdSantim: 500_000 }, //     5,000 ETB
];

function rankForTotal(totalSantim: number): Rank {
  for (const { rank, thresholdSantim } of RANK_THRESHOLDS) {
    if (totalSantim >= thresholdSantim) return rank;
  }
  return "newari";
}

function nextRankThreshold(rank: Rank): number | null {
  const currentIndex = RANK_THRESHOLDS.findIndex((r) => r.rank === rank);
  // currentIndex === -1 means rank is "newari" — next is the lowest real
  // rank, the last entry in the descending-order array above. Highest
  // rank (dejazmach, index 0) has no next threshold.
  if (currentIndex === 0) return null;
  const nextIndex = currentIndex === -1 ? RANK_THRESHOLDS.length - 1 : currentIndex - 1;
  return RANK_THRESHOLDS[nextIndex]?.thresholdSantim ?? null;
}

export async function getUserRank(userId: string): Promise<UserRank> {
  const { rows } = await pool.query<{ total_gift_spend_santim: number; rank: Rank }>(
    `SELECT total_gift_spend_santim, rank FROM user_ranks WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  const rank = row?.rank ?? "newari";
  return {
    rank,
    totalGiftSpendSantim: row?.total_gift_spend_santim ?? 0,
    nextRankThresholdSantim: nextRankThreshold(rank),
  };
}

// Called inside sendGift()'s transaction, same atomicity reasoning as
// upsertGifterBadge below — the rank update is part of the same unit as
// the money movement, not a best-effort side effect.
async function upsertUserRank(client: PoolClient, userId: string, addedSantim: number): Promise<UserRank> {
  const { rows } = await client.query<{ total_gift_spend_santim: number }>(
    `INSERT INTO user_ranks (user_id, total_gift_spend_santim, rank)
     VALUES ($1, $2, 'newari')
     ON CONFLICT (user_id) DO UPDATE
       SET total_gift_spend_santim = user_ranks.total_gift_spend_santim + $2, updated_at = now()
     RETURNING total_gift_spend_santim`,
    [userId, addedSantim]
  );
  const total = rows[0]!.total_gift_spend_santim;
  const rank = rankForTotal(total);
  await client.query(`UPDATE user_ranks SET rank = $1 WHERE user_id = $2`, [rank, userId]);
  return { rank, totalGiftSpendSantim: total, nextRankThresholdSantim: nextRankThreshold(rank) };
}

export async function listGiftTypes(): Promise<GiftType[]> {
  const { rows } = await pool.query<GiftTypeRow>(
    `SELECT gt.id, gt.name, gt.price_santim, gt.animation_key, gtier.key AS tier_key
     FROM gift_types gt JOIN gift_tiers gtier ON gtier.id = gt.gift_tier_id
     WHERE gt.is_active = TRUE ORDER BY gt.price_santim ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceSantim: row.price_santim,
    animationKey: row.animation_key,
    tierKey: row.tier_key,
  }));
}

// Grouped-by-tier shape for the Send Gursha modal's tier-then-theme
// selector — same underlying rows as listGiftTypes above, just organized
// for that specific UI instead of making the frontend re-group a flat
// list client-side.
export async function listGiftTiers(): Promise<GiftTier[]> {
  const { rows } = await pool.query<{
    key: GiftTierKey;
    display_name: string;
    base_price_santim: number;
    sort_order: number;
  }>(`SELECT key, display_name, base_price_santim, sort_order FROM gift_tiers WHERE is_active = TRUE ORDER BY sort_order ASC`);
  const giftTypes = await listGiftTypes();
  return rows.map((tier) => ({
    key: tier.key,
    displayName: tier.display_name,
    basePriceSantim: tier.base_price_santim,
    giftTypes: giftTypes.filter((gt) => gt.tierKey === tier.key),
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

// Real ledger_transactions.type values that represent genuine revenue
// earned FROM this platform's monetization systems, credited to a
// creator's own wallet — deliberately excludes 'topup' (self-funding),
// 'payout' (a debit when they cash out, not earnings), 'refund'/
// 'adjustment' (reversals/corrections), 'points_redemption' (converting
// platform-issued Watch-to-Earn points to spendable balance — not real
// viewer-to-creator revenue), and 'boost'/'gift_card' (a creator paying
// for their own promotion, and the gift-card purchase mechanism itself,
// neither of which is creator income). 'platform_subscription' never
// credits a creator's wallet at all (100% platform revenue by design,
// see subscriptions/platform-service.ts), so it's moot here either way.
const EARNING_TRANSACTION_TYPES = ["gift", "donation", "subscription", "ppv_purchase", "ad"];

function csvCell(value: string): string {
  // Minimal real CSV escaping (RFC 4180) — quote and double-up embedded
  // quotes whenever a value could contain a comma/quote/newline. Every
  // value this function actually receives (a month label, a plain
  // decimal amount, an integer count) never needs it in practice, but
  // this is the one field (Birr amount) that flows from arithmetic, not
  // a hardcoded label, so it stays real escaping rather than an assumption.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Module: creator earnings data export. Deliberately just real ledger
// data with an explicit, honest label — this does NOT claim to implement
// any specific tax proclamation or jurisdiction's compliance rules (not
// something this codebase can verify), it hands a creator the real gross
// Birr they earned per month so THEY (or their own accountant) can file
// with it.
export async function exportEarningsCsv(userId: string): Promise<string> {
  const walletId = await getUserWalletId(pool, userId);
  const { rows } = await pool.query<{ month: string; total_santim: string; transaction_count: string }>(
    `SELECT to_char(date_trunc('month', lt.created_at), 'YYYY-MM') AS month,
            SUM(le.amount_santim)::text AS total_santim,
            count(*)::text AS transaction_count
     FROM ledger_entries le
     JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
     WHERE le.wallet_id = $1
       AND le.direction = 'credit'
       AND lt.type = ANY($2)
       AND lt.status = 'completed'
     GROUP BY date_trunc('month', lt.created_at)
     ORDER BY date_trunc('month', lt.created_at) ASC`,
    [walletId, EARNING_TRANSACTION_TYPES]
  );

  const header = ["Month", "Gross Birr Earned", "Transaction Count"];
  const lines = rows.map((row) =>
    [row.month, (Number(row.total_santim) / 100).toFixed(2), row.transaction_count].map(csvCell).join(",")
  );
  return [header.join(","), ...lines].join("\n");
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

export async function sendGift(senderId: string, input: SendGiftInput): Promise<SendGiftResponse> {
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

    // Dedication target, not a money recipient — the creator above is
    // always who's actually paid. Validated for existence only so the
    // alert/chat display doesn't silently show a broken reference.
    if (input.recipientId) {
      const recipientResult = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.recipientId]);
      if (!recipientResult.rows[0]) throw new AppError(404, "Recipient not found");
    }

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
      `INSERT INTO gifts_sent (ledger_transaction_id, sender_id, creator_id, stream_id, gift_type_id, quantity, message, recipient_id, is_anonymous)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ledgerTransactionId,
        senderId,
        stream.creator_id,
        input.streamId,
        input.giftTypeId,
        input.quantity,
        input.message ?? null,
        input.recipientId ?? null,
        input.isAnonymous ?? false,
      ]
    );

    const badge = await upsertGifterBadge(client, senderId, stream.creator_id, totalAmount);
    const rank = await upsertUserRank(client, senderId, totalAmount);

    await client.query("COMMIT");

    if (input.message) {
      await flagIfMatched("gift_message", ledgerTransactionId, senderId, input.message);
    }

    const { rows: alertRows } = await pool.query<{
      username: string;
      display_name: string;
      gift_name: string;
      animation_key: string;
      recipient_username: string | null;
    }>(
      `SELECT u.username, u.display_name, gt.name AS gift_name, gt.animation_key,
              (SELECT username FROM users WHERE id = $3) AS recipient_username
       FROM users u, gift_types gt
       WHERE u.id = $1 AND gt.id = $2`,
      [senderId, input.giftTypeId, input.recipientId ?? null]
    );
    const alertInfo = alertRows[0];
    if (alertInfo) {
      const isAnonymous = input.isAnonymous ?? false;
      await publishStreamAlert({
        kind: "gift",
        id: ledgerTransactionId,
        streamId: input.streamId,
        senderId,
        senderUsername: isAnonymous ? null : alertInfo.username,
        senderDisplayName: isAnonymous ? null : alertInfo.display_name,
        isAnonymous,
        recipientUsername: alertInfo.recipient_username,
        giftTypeId: input.giftTypeId,
        giftName: alertInfo.gift_name,
        animationKey: alertInfo.animation_key,
        quantity: input.quantity,
        totalSantim: totalAmount,
        message: input.message ?? null,
        badgeTier: badge.tier,
        createdAt: new Date().toISOString(),
      });

      const isAnonymousForNotify = input.isAnonymous ?? false;
      await notify(
        stream.creator_id,
        "gursha_received",
        isAnonymousForNotify ? "You received a Gursha" : `${alertInfo.display_name} sent you a Gursha`,
        { body: `${alertInfo.gift_name} x${input.quantity}`, linkUrl: "/wallet" }
      );
    }

    return { id: ledgerTransactionId, badge, rank };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Module 2 — a free-form cash tip, funded from the donor's existing
// wallet balance (topped up via the real Chapa checkout integration
// above) rather than a separate direct-charge path — see
// db/migrations/0033_donations_and_ppv.sql's comment. Mirrors sendGift's
// shape (ledger split by revenue_share_bps, gifter badge/rank update,
// same gift-alerts:<streamId> channel) since a donation is real money
// support for a creator, same as a catalog gift — just without a catalog
// item attached.
export async function sendDonation(donorId: string, input: DonateInput): Promise<DonateResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const streamResult = await client.query<{ creator_id: string }>(
      `SELECT creator_id FROM streams WHERE id = $1`,
      [input.streamId]
    );
    const stream = streamResult.rows[0];
    if (!stream) throw new AppError(404, "Stream not found");
    if (stream.creator_id === donorId) throw new AppError(400, "You can't donate to your own stream");

    const profileResult = await client.query<{ revenue_share_bps: number }>(
      `SELECT revenue_share_bps FROM creator_profiles WHERE user_id = $1`,
      [stream.creator_id]
    );
    const profile = profileResult.rows[0];
    if (!profile) throw new AppError(404, "Creator has no payout profile");

    const donorWalletId = await getUserWalletId(client, donorId);
    const creatorWalletId = await getUserWalletId(client, stream.creator_id);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [donorWalletId]
    );
    const donorBalance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (donorBalance < input.amountSantim) throw new AppError(400, "Insufficient balance");

    const creatorShare = Math.trunc((input.amountSantim * profile.revenue_share_bps) / 10_000);
    const platformShare = input.amountSantim - creatorShare;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, stream_id, status, completed_at)
       VALUES ('donation', $1, 'completed', now()) RETURNING id`,
      [input.streamId]
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, donorWalletId, "debit", input.amountSantim);
    await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

    await applyBalanceDelta(client, donorWalletId, -input.amountSantim);
    await applyBalanceDelta(client, creatorWalletId, creatorShare);
    await applyBalanceDelta(client, platformWalletId, platformShare);

    const isAnonymous = input.isAnonymous ?? false;
    await client.query(
      `INSERT INTO donations (ledger_transaction_id, donor_id, creator_id, stream_id, amount_santim, message, is_anonymous)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ledgerTransactionId, donorId, stream.creator_id, input.streamId, input.amountSantim, input.message ?? null, isAnonymous]
    );

    const badge = await upsertGifterBadge(client, donorId, stream.creator_id, input.amountSantim);
    const rank = await upsertUserRank(client, donorId, input.amountSantim);

    await client.query("COMMIT");

    if (input.message) {
      await flagIfMatched("donation_message", ledgerTransactionId, donorId, input.message);
    }

    const { rows: donorRows } = await pool.query<{ username: string; display_name: string }>(
      `SELECT username, display_name FROM users WHERE id = $1`,
      [donorId]
    );
    const donorInfo = donorRows[0];
    if (donorInfo) {
      await publishStreamAlert({
        kind: "donation",
        id: ledgerTransactionId,
        streamId: input.streamId,
        donorId,
        donorUsername: isAnonymous ? null : donorInfo.username,
        donorDisplayName: isAnonymous ? null : donorInfo.display_name,
        isAnonymous,
        amountSantim: input.amountSantim,
        message: input.message ?? null,
        createdAt: new Date().toISOString(),
      });

      await notify(
        stream.creator_id,
        "donation_received",
        isAnonymous ? "You received a donation" : `${donorInfo.display_name} sent you a donation`,
        { body: `${(input.amountSantim / 100).toFixed(2)} ETB`, linkUrl: "/wallet" }
      );
    }

    return { id: ledgerTransactionId, badge, rank };
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

// Dispatches to the Temporal-backed workflow when TEMPORAL_ADDRESS is
// configured, otherwise falls back to requestPayoutLegacy below —
// byte-for-byte the original implementation, unchanged, so behavior is
// identical to before this migration until a real Temporal server exists
// (see docs/temporal-migration-plan.md). Same dispatch pattern for
// approvePayout/rejectPayout/completePayoutFromWebhook further down.
export async function requestPayout(creatorId: string, input: RequestPayoutInput): Promise<PayoutResponse> {
  // Module 1.3: a 72h hold after a password change or 2FA enable/disable —
  // see common/security-hold.ts. Checked once here, ahead of both the
  // Temporal and legacy paths below, since either is a real funds
  // movement this is meant to gate.
  const hold = await getActiveSecurityHold(creatorId);
  if (hold) {
    throw new AppError(
      403,
      `For your security, withdrawals are paused for 72 hours after a password or 2FA change. Try again after ${hold.until.toISOString()}.`
    );
  }

  // Module 1.4 — off by default (0032_kyc.sql), an admin opts in from
  // Admin Settings once the review queue is staffed.
  if (await getKycRequiredForPayouts()) {
    if (!(await hasApprovedKyc(creatorId))) {
      throw new AppError(403, "Identity verification required before payouts — submit your Fayda or Kebele ID in Settings.");
    }
  }

  if (!isTemporalConfigured) return requestPayoutLegacy(creatorId, input);

  const { rows: userRows } = await pool.query<{ display_name: string; is_suspended: boolean }>(
    `SELECT display_name, is_suspended FROM users WHERE id = $1`,
    [creatorId]
  );
  if (userRows[0]?.is_suspended) throw new AppError(403, "Your payout privileges are currently suspended");
  const displayName = userRows[0]?.display_name ?? "Birq Creator";

  const reviewThreshold = await getPayoutManualReviewThreshold();
  const requiresManualApproval = input.amountSantim >= reviewThreshold;
  const payoutId = randomUUID();

  // Fire-and-continue, not fire-and-wait: unlike the legacy path (which
  // synchronously awaited the Chapa call and could return a 502 with the
  // balance already refunded if it failed immediately), starting a
  // workflow only waits for Temporal to accept and durably record the
  // start — the actual transfer attempt happens in the background. A
  // creator finds out about a failure via the existing notify() call
  // inside the reverseFunds/markPaid activities, not synchronously in
  // this HTTP response. This is a deliberate, real behavior change, not
  // an oversight — see docs/temporal-migration-plan.md.
  await startPayoutWorkflow({
    payoutId,
    creatorId,
    amountSantim: input.amountSantim,
    method: input.method,
    destination: input.destination,
    bankCode: input.method === "bank" ? input.bankCode! : "",
    displayName,
    requiresManualApproval,
  });

  return {
    id: payoutId,
    amountSantim: input.amountSantim,
    status: requiresManualApproval ? "pending_review" : "processing",
    requiresManualApproval,
  };
}

async function requestPayoutLegacy(
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
  const reviewThreshold = await getPayoutManualReviewThreshold();
  const requiresManualApproval = input.amountSantim >= reviewThreshold;

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
  if (isTemporalConfigured) {
    // Preserve the legacy path's guard: a workflow's approvePayoutSignal
    // handler silently ignores a second/late signal (see workflow.ts) —
    // fine internally, but the admin UI still needs the same 404/400 this
    // endpoint always returned for a stale double-click or wrong ID,
    // rather than a signal call quietly no-op'ing with a 200.
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM payouts WHERE id = $1`, [payoutId]);
    if (!rows[0]) throw new AppError(404, "Payout not found");
    if (rows[0].status !== "pending_review") throw new AppError(400, "Payout is not awaiting review");

    await signalApprove(payoutId, adminUserId);
    await logAdminAction(adminUserId, "payout.approve", "payout", payoutId, {});
    return;
  }
  return approvePayoutLegacy(payoutId, adminUserId);
}

async function approvePayoutLegacy(payoutId: string, adminUserId: string): Promise<void> {
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
    await notify(creatorId, "payout_failed", "Your payout failed", {
      body: "It's been refunded to your wallet balance — check Wallet for details",
      linkUrl: "/wallet",
    });
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
  if (isTemporalConfigured) {
    const { rows } = await pool.query<{ status: string; creator_id: string; amount_santim: number }>(
      `SELECT status, creator_id, amount_santim FROM payouts WHERE id = $1`,
      [payoutId]
    );
    if (!rows[0]) throw new AppError(404, "Payout not found");
    if (rows[0].status !== "pending_review") throw new AppError(400, "Payout is not awaiting review");

    await signalReject(payoutId, adminUserId, reason);
    await logAdminAction(adminUserId, "payout.reject", "payout", payoutId, {
      reason,
      metadata: { creatorId: rows[0].creator_id, amountSantim: rows[0].amount_santim },
    });
    return;
  }
  return rejectPayoutLegacy(payoutId, adminUserId, reason);
}

async function rejectPayoutLegacy(payoutId: string, adminUserId: string, reason: string): Promise<void> {
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

  const { rows: notifyRows } = await pool.query<{ creator_id: string }>(
    `SELECT creator_id FROM payouts WHERE id = $1`,
    [payoutId]
  );
  if (notifyRows[0]) {
    await notify(notifyRows[0].creator_id, "payout_failed", "Your payout was rejected", {
      body: reason,
      linkUrl: "/wallet",
    });
  }
}

export async function completePayoutFromWebhook(webhook: ChapaTransferWebhook): Promise<void> {
  if (isTemporalConfigured) {
    const isSuccess = webhook.status.toLowerCase() === "success";
    try {
      await signalChapaTransferOutcome(webhook.reference, {
        success: isSuccess,
        reason: isSuccess ? undefined : `Chapa reported transfer status: ${webhook.status}`,
      });
    } catch (err) {
      // The workflow may have already completed and closed (e.g. a
      // duplicate/retried webhook delivery arriving after the first one
      // was already processed) — Temporal can't signal a closed workflow
      // execution. That's the same idempotent-no-op outcome the legacy
      // path's explicit status check gave a retried webhook, just
      // surfaced as a caught error here instead of a status comparison.
      // Anything else (e.g. Temporal genuinely unreachable) should still
      // propagate so Chapa's retry logic keeps trying.
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|already completed|workflow execution/i.test(message)) throw err;
    }
    return;
  }
  return completePayoutFromWebhookLegacy(webhook);
}

async function completePayoutFromWebhookLegacy(webhook: ChapaTransferWebhook): Promise<void> {
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

    await notify(
      payout.creator_id,
      isSuccess ? "payout_processed" : "payout_failed",
      isSuccess ? "Your payout was sent" : "Your payout failed",
      {
        body: isSuccess
          ? `${(payout.amount_santim / 100).toFixed(2)} birr is on its way`
          : "It's been refunded to your wallet balance — check Wallet for details",
        linkUrl: "/wallet",
      }
    );
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
  if (row.type === "platform_subscription") return "Birq ad-free subscription";
  // No extra joins for donor/creator display names here (unlike gift's
  // sender_u/creator_u above) — donations/PPV purchases don't currently
  // need that level of detail in the transaction list, just a clear,
  // correct label instead of the generic "Balance adjustment" fallback
  // every one of these three used to fall through to.
  if (row.type === "donation") return row.direction === "debit" ? "Sent a donation" : "Received a donation";
  if (row.type === "ppv_purchase") return row.direction === "debit" ? "Bought stream access" : "PPV ticket sale";
  if (row.type === "points_redemption") return "Redeemed Birq Points";
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
