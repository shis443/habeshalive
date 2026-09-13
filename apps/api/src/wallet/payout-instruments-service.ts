import type { PayoutMethod } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { decryptSecret, encryptSecret } from "../common/crypto.js";
import { logAdminAction } from "../admin/audit.js";
import { chapaPayoutClient } from "./chapa-client.js";

// Chapa's own bank directory doesn't have a stable, documented code for
// Telebirr — resolved by name lookup against GET /v1/banks, same as
// wallet/service.ts's own copy of this constant (kept local rather than
// exported/shared, since it's a single-purpose literal, not a reusable
// concept).
const TELEBIRR_BANK_NAME_FRAGMENT = "telebirr";

export interface PayoutInstrument {
  id: string;
  creatorId: string;
  method: PayoutMethod;
  displayTail: string;
  accountHolder: string;
  bankCode: string | null;
  status: "unverified" | "verified" | "failed" | "retired";
  usableFrom: string;
  createdAt: string;
  verifiedAt: string | null;
}

interface InstrumentRow {
  id: string;
  creator_id: string;
  method: PayoutMethod;
  display_tail: string;
  account_holder: string;
  bank_code: string | null;
  status: PayoutInstrument["status"];
  usable_from: string;
  created_at: string;
  verified_at: string | null;
}

function mapRow(row: InstrumentRow): PayoutInstrument {
  return {
    id: row.id,
    creatorId: row.creator_id,
    method: row.method,
    displayTail: row.display_tail,
    accountHolder: row.account_holder,
    bankCode: row.bank_code,
    status: row.status,
    usableFrom: row.usable_from,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

const SELECT_INSTRUMENT = `
  SELECT id, creator_id, method, display_tail, account_holder, bank_code, status, usable_from, created_at, verified_at
  FROM payout_instruments
`;

export interface BindPayoutInstrumentInput {
  method: PayoutMethod;
  accountNumber: string;
  accountHolder: string;
  bankCode?: string;
}

// The one place a creator's full account/telebirr number ever passes
// through this codebase (see 0060's migration comment for why it has to
// be stored at all, and why encrypted rather than a real processor
// token). Never returned from here or anywhere else — every caller gets
// mapRow's PayoutInstrument, which only ever carries displayTail.
export async function bindPayoutInstrument(
  creatorId: string,
  input: BindPayoutInstrumentInput
): Promise<PayoutInstrument> {
  const accountNumber = input.accountNumber.trim();
  if (accountNumber.length < 4) throw new AppError(400, "Account number is too short");

  const bankCode =
    input.method === "telebirr"
      ? await chapaPayoutClient.resolveBankCodeByName(TELEBIRR_BANK_NAME_FRAGMENT)
      : input.bankCode;
  if (input.method === "bank" && !bankCode) throw new AppError(400, "bankCode is required for bank instruments");

  const { rows } = await pool.query<InstrumentRow>(
    `INSERT INTO payout_instruments (creator_id, method, display_tail, account_holder, bank_code, encrypted_account_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, creator_id, method, display_tail, account_holder, bank_code, status, usable_from, created_at, verified_at`,
    [creatorId, input.method, accountNumber.slice(-4), input.accountHolder, bankCode ?? null, encryptSecret(accountNumber)]
  );
  return mapRow(rows[0]!);
}

export async function listPayoutInstruments(creatorId: string): Promise<PayoutInstrument[]> {
  const { rows } = await pool.query<InstrumentRow>(
    `${SELECT_INSTRUMENT} WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId]
  );
  return rows.map(mapRow);
}

export async function getPayoutInstrument(instrumentId: string): Promise<PayoutInstrument | null> {
  const { rows } = await pool.query<InstrumentRow>(`${SELECT_INSTRUMENT} WHERE id = $1`, [instrumentId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// idx_payout_instrument_default (0060) guarantees at most one 'verified'
// row per creator platform-wide, regardless of method — so this is a
// direct lookup, not a "which one" choice. Used by
// admin/payout-batches-service.ts (T7), which only has a creatorId +
// target method per selection, not an instrumentId, to resolve.
export async function getVerifiedInstrumentForCreator(creatorId: string): Promise<PayoutInstrument | null> {
  const { rows } = await pool.query<InstrumentRow>(
    `${SELECT_INSTRUMENT} WHERE creator_id = $1 AND status = 'verified'`,
    [creatorId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

// The ONLY function in this codebase that ever decrypts a payout
// instrument's account number back to plaintext — called exclusively
// from wallet/temporal/activities.ts's initiateChapaTransfer, at the
// exact moment Chapa's transfer API needs it, and never passed through a
// Temporal workflow input (which Temporal durably persists in its own
// event history — see 0060's migration comment).
export async function decryptPayoutInstrumentAccountNumber(instrumentId: string): Promise<string> {
  const { rows } = await pool.query<{ encrypted_account_number: string }>(
    `SELECT encrypted_account_number FROM payout_instruments WHERE id = $1`,
    [instrumentId]
  );
  if (!rows[0]) throw new AppError(404, "Payout instrument not found");
  return decryptSecret(rows[0].encrypted_account_number);
}

// Mirrors kyc/service.ts's approveKyc/rejectKyc pattern — human review
// before an instrument can ever receive real money, same reasoning as
// KYC: this is exactly the kind of thing a person should check.
export async function verifyPayoutInstrument(adminId: string, instrumentId: string): Promise<void> {
  const { rows } = await pool.query<{ creator_id: string }>(
    `UPDATE payout_instruments SET status = 'verified', verified_at = now(), verified_by = $1
     WHERE id = $2 AND status = 'unverified'
     RETURNING creator_id`,
    [adminId, instrumentId]
  );
  if (!rows[0]) throw new AppError(404, "Instrument not found or already reviewed");
  await logAdminAction(adminId, "payout_instrument.verify", "payout_instrument", instrumentId, {
    before: { status: "unverified" },
    after: { status: "verified" },
  });
}

export async function rejectPayoutInstrument(adminId: string, instrumentId: string, reason: string): Promise<void> {
  const { rows } = await pool.query<{ creator_id: string }>(
    `UPDATE payout_instruments SET status = 'failed'
     WHERE id = $1 AND status = 'unverified'
     RETURNING creator_id`,
    [instrumentId]
  );
  if (!rows[0]) throw new AppError(404, "Instrument not found or already reviewed");
  await logAdminAction(adminId, "payout_instrument.reject", "payout_instrument", instrumentId, {
    reason,
    before: { status: "unverified" },
    after: { status: "failed" },
  });
}

export async function retirePayoutInstrument(creatorId: string, instrumentId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE payout_instruments SET status = 'retired'
     WHERE id = $1 AND creator_id = $2 AND status IN ('unverified', 'verified')
     RETURNING id`,
    [instrumentId, creatorId]
  );
  if (!rows[0]) throw new AppError(404, "Instrument not found or already retired");
}

// The single gate every payout path (individual requestPayout, batch
// creation) uses before reserving funds against an instrument — owned by
// this creator, verified, and past its 72h cooling-off. Throws with a
// specific, user-facing reason rather than a generic 403/404, since "an
// instrument exists but isn't usable yet" and "no such instrument" are
// different problems for a creator to act on.
export async function getUsableVerifiedInstrument(
  creatorId: string,
  instrumentId: string
): Promise<{ id: string; method: PayoutMethod; bankCode: string | null; displayTail: string }> {
  const { rows } = await pool.query<{
    id: string;
    method: PayoutMethod;
    bank_code: string | null;
    display_tail: string;
    status: PayoutInstrument["status"];
    usable_from: string;
  }>(
    `SELECT id, method, bank_code, display_tail, status, usable_from
     FROM payout_instruments WHERE id = $1 AND creator_id = $2`,
    [instrumentId, creatorId]
  );
  const instrument = rows[0];
  if (!instrument) throw new AppError(404, "Payout instrument not found");
  if (instrument.status !== "verified") {
    throw new AppError(400, "This payout instrument hasn't been verified yet");
  }
  if (new Date(instrument.usable_from).getTime() > Date.now()) {
    throw new AppError(
      400,
      `This payout instrument is still in its 72-hour security hold — usable from ${instrument.usable_from}`
    );
  }
  return { id: instrument.id, method: instrument.method, bankCode: instrument.bank_code, displayTail: instrument.display_tail };
}
