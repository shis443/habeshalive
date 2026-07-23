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

export async function insertEntry(
  client: PoolClient,
  ledgerTransactionId: string,
  walletId: string,
  direction: "debit" | "credit",
  amountSantim: number
): Promise<void> {
  if (amountSantim <= 0) return;
  await client.query(
    `INSERT INTO ledger_entries (ledger_transaction_id, wallet_id, direction, amount_santim)
     VALUES ($1, $2, $3, $4)`,
    [ledgerTransactionId, walletId, direction, amountSantim]
  );
}
