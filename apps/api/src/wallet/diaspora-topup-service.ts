import { randomUUID } from "node:crypto";
import type { DiasporaProvider, TopupResponse } from "@birq/shared";
import { pool } from "../common/db.js";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import { getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { paypalClient } from "./paypal-client.js";
import { stripeClient } from "./stripe-client.js";

// Module 2's "diaspora bridge" — Stripe/PayPal top-ups for donors outside
// Ethiopia who can't use Telebirr/CBE Birr/local cards at all. Telebirr
// and CBE Birr deliberately have NO separate client anywhere in this
// codebase: they're payment METHODS inside Chapa's own hosted checkout
// (wallet/chapa-client.ts's initializeCheckout), not independent payment
// gateways with their own developer API the way Stripe/Chapa/PayPal are
// — Chapa already IS the "real-time Telebirr/CBE Birr" integration this
// module's spec asked for, live since the original Chapa work. Building
// a second, parallel "TelebirrClient" here would just reimplement a
// slice of what Chapa's checkout page already does.
//
// Reuses the exact same ledger_transactions row shape as a normal Chapa
// top-up (initiateTopup in service.ts) — type='topup', credit the
// buyer's wallet / debit the platform wallet, completed by the same
// completeTopupFromWebhook once a webhook confirms payment. The only
// difference is which client generates the checkout URL and the
// USD-cents-to-ETB-santim conversion, since Stripe/PayPal charge in USD
// while this platform's ledger is ETB santim throughout.
export async function initiateDiasporaTopup(
  userId: string,
  amountUsdCents: number,
  provider: DiasporaProvider
): Promise<TopupResponse> {
  if (!env.DIASPORA_USD_TO_ETB_RATE) {
    throw new AppError(503, "Card top-ups aren't available right now — try Telebirr/CBE Birr/local cards instead.");
  }

  const amountSantim = Math.round(amountUsdCents * env.DIASPORA_USD_TO_ETB_RATE);
  const reference = `diaspora_${provider}_${randomUUID()}`;

  const { rows: userRows } = await pool.query<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [
    userId,
  ]);
  const user = userRows[0];
  if (!user) throw new AppError(404, "User not found");
  // Same synthetic-placeholder reasoning as initiateTopup — Stripe/PayPal
  // both require an email and not every account here has a real one.
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

  const { checkoutUrl } =
    provider === "stripe"
      ? await stripeClient.createCheckoutSession(amountUsdCents, reference, { email })
      : await paypalClient.createOrder(amountUsdCents, reference);

  return { reference, checkoutUrl };
}

// Completion reuses wallet/service.ts's completeTopupFromWebhook as-is
// (see wallet/routes.ts's stripe/paypal webhook handlers) — the ledger
// side neither knows nor cares which provider funded a 'topup'
// transaction, only that its `reference` matches.
