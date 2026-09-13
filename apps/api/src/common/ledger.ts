import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { AppError } from "./errors.js";

export async function getUserWalletId(client: PoolClient | typeof pool, userId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = $1 AND currency = 'ETB'`,
    [userId]
  );
  const wallet = rows[0];
  if (!wallet) throw new AppError(404, "Wallet not found for this user");
  return wallet.id;
}

export async function getPlatformWalletId(client: PoolClient | typeof pool): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB' LIMIT 1`
  );
  const wallet = rows[0];
  if (!wallet) throw new AppError(500, "Platform wallet is not provisioned");
  return wallet.id;
}

export async function applyBalanceDelta(
  client: PoolClient,
  walletId: string,
  deltaSantim: number
): Promise<void> {
  await client.query(
    `INSERT INTO wallet_balances_cache (wallet_id, balance_santim, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (wallet_id)
     DO UPDATE SET balance_santim = wallet_balances_cache.balance_santim + $2, updated_at = now()`,
    [walletId, deltaSantim]
  );
}

export type FundingBucket = "paid" | "promotional";

// Returns the inserted row's id (or null when amountSantim <= 0 and
// nothing was inserted, the existing no-op behavior) — needed by
// creditCreatorFromViewerSpend below, which must reference the specific
// paid-bucket credit entry from earning_holds.ledger_entry_id. Every
// pre-existing call site already ignores the return value, so this is a
// backward-compatible addition, not a breaking change.
export async function insertEntry(
  client: PoolClient,
  ledgerTransactionId: string,
  walletId: string,
  direction: "debit" | "credit",
  amountSantim: number,
  // Default 'paid' preserves every pre-existing call site's behavior
  // unchanged — this parameter only matters to callers that need to say
  // otherwise (redeemPoints crediting promotional, sendGift splitting a
  // debit/credit across both).
  fundingBucket: FundingBucket = "paid"
): Promise<string | null> {
  if (amountSantim <= 0) return null;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_entries (ledger_transaction_id, wallet_id, direction, amount_santim, funding_bucket)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ledgerTransactionId, walletId, direction, amountSantim, fundingBucket]
  );
  return rows[0]!.id;
}

// Derived directly from ledger_entries, not a cache column — ground rule:
// no new running-total counter, since a counter is a second source of
// truth and it will drift. wallet_balances_cache stays exactly as it was,
// a single pooled total unaware buckets exist; this is the only place
// that ever answers "how much of this wallet's balance is promotional
// vs. paid, right now."
//
// Must be called with the same client already holding sendGift's existing
// `SELECT balance_santim ... FOR UPDATE` lock on wallet_balances_cache —
// that lock is what serializes concurrent spends from the same wallet, so
// this read is never racing a concurrent debit/credit to the same wallet.
export async function getBucketBalances(
  client: PoolClient,
  walletId: string
): Promise<{ paid: number; promotional: number }> {
  const { rows } = await client.query<{ funding_bucket: FundingBucket; direction: "debit" | "credit"; total: string }>(
    `SELECT funding_bucket, direction, SUM(amount_santim)::text AS total
     FROM ledger_entries
     WHERE wallet_id = $1
     GROUP BY funding_bucket, direction`,
    [walletId]
  );
  let paid = 0;
  let promotional = 0;
  for (const row of rows) {
    const signed = row.direction === "credit" ? Number(row.total) : -Number(row.total);
    if (row.funding_bucket === "paid") paid += signed;
    else promotional += signed;
  }
  return { paid, promotional };
}

// Splits amountSantim across the two buckets, promotional first — "so the
// refundable balance survives longest and refund exposure shrinks
// fastest" (the architecture review's own reasoning for this spend
// order). Used identically for a debit (draining a sender's balance) and
// for proportionally allocating a credit across the same two buckets a
// gift's debit side drew from.
export function splitByBucket(
  amountSantim: number,
  availablePromotional: number
): { promotional: number; paid: number } {
  const promotional = Math.max(0, Math.min(amountSantim, availablePromotional));
  return { promotional, paid: amountSantim - promotional };
}

export interface CreatorEarningSplitInput {
  ledgerTransactionId: string;
  viewerWalletId: string;
  creatorId: string;
  creatorWalletId: string;
  platformWalletId: string;
  totalAmount: number;
  creatorShare: number;
  platformShare: number;
  // 14 days, matching earning_holds.clears_at's own column default —
  // passed explicitly (rather than relying on the column default) so a
  // test can advance past a short window without waiting 14 real days.
  clearsInMs?: number;
}

const DEFAULT_CLEARING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// The one place every viewer-funded creator credit goes through —
// sendGift, sendDonation, PPV purchases, subscription payments, boost
// purchases (wallet/service.ts, streams/ppv-service.ts,
// subscriptions/service.ts, admin/boosts-service.ts) all credit a
// creator from a viewer's own wallet balance, and every one of them has
// the identical "promotional money must never become a withdrawable
// creator earning" exposure a viewer could otherwise route around simply
// by choosing a different spend than a gift. One shared implementation,
// not five separately-written and separately-reviewed copies of
// financial splitting logic.
//
// Does three things atomically (caller supplies an already-open
// transaction client):
//   1. Debits the viewer, promotional bucket first (T2's spend order —
//      "so the refundable balance survives longest and refund exposure
//      shrinks fastest").
//   2. Credits the creator and platform in the SAME proportion the debit
//      was split — a gift 60% funded by promotional balance credits the
//      creator 60% promotional-sourced, not "paid" by default. This is
//      what makes the invariant a real, provable database fact rather
//      than a label on the original credit that erodes as money moves.
//   3. Creates an earning_holds row ONLY for the creator's paid-bucket
//      portion. The promotional portion is credited to the creator's
//      wallet immediately and spendably (they can gift it onward, same
//      as a viewer could) but never gets a hold row at all — there is
//      nothing for v_creator_withdrawable to exclude, because nothing was
//      ever written for it to exclude.
export async function creditCreatorFromViewerSpend(
  client: PoolClient,
  input: CreatorEarningSplitInput
): Promise<void> {
  const { paid: viewerPaid, promotional: viewerPromotional } = await getBucketBalances(
    client,
    input.viewerWalletId
  );
  const debitSplit = splitByBucket(input.totalAmount, viewerPromotional);

  await insertEntry(
    client,
    input.ledgerTransactionId,
    input.viewerWalletId,
    "debit",
    debitSplit.promotional,
    "promotional"
  );
  await insertEntry(client, input.ledgerTransactionId, input.viewerWalletId, "debit", debitSplit.paid, "paid");

  // Proportional split of each share to the same ratio as the debit.
  // Bounds proven before writing this (not just asserted): with
  // 0 <= creatorShare <= totalAmount and 0 <= debitSplit.promotional <=
  // totalAmount, creatorPromo = trunc(creatorShare * promo / total)
  // satisfies 0 <= creatorPromo <= min(creatorShare, debitSplit.promotional)
  // in every case, which is what keeps every one of the four derived
  // values below non-negative and keeps the whole split balanced — the
  // four credit entries below always sum to exactly totalAmount, same as
  // the two debit entries above, which is what the deferred balance
  // trigger (migration 0048) actually checks at COMMIT.
  const creatorPromo =
    input.totalAmount > 0
      ? Math.trunc((input.creatorShare * debitSplit.promotional) / input.totalAmount)
      : 0;
  const creatorPaid = input.creatorShare - creatorPromo;
  const platformPromo = debitSplit.promotional - creatorPromo;
  const platformPaid = input.platformShare - platformPromo;

  await insertEntry(client, input.ledgerTransactionId, input.creatorWalletId, "credit", creatorPromo, "promotional");
  const creatorPaidEntryId = await insertEntry(
    client,
    input.ledgerTransactionId,
    input.creatorWalletId,
    "credit",
    creatorPaid,
    "paid"
  );
  await insertEntry(client, input.ledgerTransactionId, input.platformWalletId, "credit", platformPromo, "promotional");
  await insertEntry(client, input.ledgerTransactionId, input.platformWalletId, "credit", platformPaid, "paid");

  await applyBalanceDelta(client, input.viewerWalletId, -input.totalAmount);
  await applyBalanceDelta(client, input.creatorWalletId, input.creatorShare);
  await applyBalanceDelta(client, input.platformWalletId, input.platformShare);

  if (creatorPaidEntryId) {
    const clearsInMs = input.clearsInMs ?? DEFAULT_CLEARING_WINDOW_MS;
    await client.query(
      `INSERT INTO earning_holds (creator_id, ledger_entry_id, amount_santim, clears_at)
       VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
      [input.creatorId, creatorPaidEntryId, creatorPaid, clearsInMs]
    );
  }

  void viewerPaid; // Read for its side effect of proving getBucketBalances ran; not otherwise used.
}
