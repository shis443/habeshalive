import { randomInt } from "node:crypto";
import type {
  GiftCardAdminItem,
  GiftCardPreview,
  MyGiftCard,
  PurchaseGiftCardInput,
  PurchaseGiftCardResponse,
} from "@habeshalive/shared";
import { logAdminAction } from "../admin/audit.js";
import { getGiftCardExpiryMonths } from "../admin/config-service.js";
import { emailGateway } from "../auth/email-gateway.js";
import { smsGateway } from "../auth/sms-gateway.js";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { notify } from "../notifications/service.js";

// Ambiguous characters (0/O, 1/I/L) excluded — this gets read aloud,
// typed from a phone screenshot, etc.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")
  );
  return groups.join("-");
}

function redemptionUrl(code: string): string {
  return `${env.WEB_PUBLIC_URL}/gift-cards/redeem?code=${encodeURIComponent(code)}`;
}

export async function purchaseGiftCard(
  purchaserId: string,
  input: PurchaseGiftCardInput
): Promise<PurchaseGiftCardResponse> {
  const expiryMonths = await getGiftCardExpiryMonths();

  const client = await pool.connect();
  let code!: string;
  let giftCardId!: string;
  try {
    await client.query("BEGIN");

    const purchaserWalletId = await getUserWalletId(client, purchaserId);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [purchaserWalletId]
    );
    const balance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (balance < input.amountSantim) throw new AppError(400, "Insufficient balance");

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('gift_card', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = txRows[0]!.id;

    // Purchase debits the buyer and credits a platform liability position
    // (the platform wallet, same "clearing account for value the platform
    // now owes out" role it plays for topups and ad revenue) — redemption
    // below is the mirror image, debiting the platform and crediting the
    // real recipient. Both legs are real double-entry, never a direct
    // balance write.
    await insertEntry(client, ledgerTransactionId, purchaserWalletId, "debit", input.amountSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", input.amountSantim);
    await applyBalanceDelta(client, purchaserWalletId, -input.amountSantim);
    await applyBalanceDelta(client, platformWalletId, input.amountSantim);

    // Collision odds on a 12-char code from a 32-symbol alphabet are
    // astronomically low, but the column has a real UNIQUE constraint —
    // retry on the off chance rather than trusting probability alone.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO gift_cards (code, amount_santim, design_theme, personal_message, purchaser_id,
                                  recipient_phone, recipient_email, ledger_transaction_id, scheduled_delivery_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '1 month' * $10)
         ON CONFLICT (code) DO NOTHING
         RETURNING id`,
        [
          candidate,
          input.amountSantim,
          input.designTheme,
          input.personalMessage ?? null,
          purchaserId,
          input.recipientPhone ?? null,
          input.recipientEmail ?? null,
          ledgerTransactionId,
          input.scheduledDeliveryAt ?? null,
          expiryMonths,
        ]
      );
      if (rows[0]) {
        code = candidate;
        giftCardId = rows[0].id;
        break;
      }
    }
    if (!giftCardId) throw new AppError(500, "Failed to generate a unique gift card code");

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Delivery is best-effort, same posture as every other notification
  // send in this codebase (see chat/service.ts's publishToCentrifugo) —
  // the card is already durably issued and redeemable by code/link
  // regardless of whether the delivery message itself lands.
  if (!input.scheduledDeliveryAt) {
    await deliverGiftCard(giftCardId, code, input);
  }

  return { id: giftCardId, code, redemptionUrl: redemptionUrl(code) };
}

async function deliverGiftCard(
  giftCardId: string,
  code: string,
  input: Pick<PurchaseGiftCardInput, "deliveryMethod" | "recipientEmail" | "recipientPhone" | "amountSantim" | "personalMessage">
): Promise<void> {
  const amountBirr = (input.amountSantim / 100).toFixed(2);
  const url = redemptionUrl(code);
  try {
    if (input.deliveryMethod === "email" && input.recipientEmail) {
      await emailGateway.sendGiftCard(input.recipientEmail, url, amountBirr, input.personalMessage);
    } else if (input.deliveryMethod === "sms" && input.recipientPhone) {
      await smsGateway.sendGiftCard(input.recipientPhone, url, amountBirr);
    }
    // "link" delivery needs no send — the purchaser copies/shares
    // redemptionUrl themselves, already returned from purchaseGiftCard().
  } catch (err) {
    console.error(`[gift-cards] delivery failed for ${giftCardId}:`, err);
  }
}

// Scheduled sends — same periodic-job pattern as the reaper/VOD-cleanup/
// ad-settlement jobs in server.ts. Picks up any card whose
// scheduled_delivery_at has passed and hasn't been sent yet (tracked via
// scheduled_delivery_at being cleared once actually sent, so a re-run
// after a crash can't double-send).
export async function sendScheduledGiftCards(): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    code: string;
    amount_santim: number;
    personal_message: string | null;
    recipient_email: string | null;
    recipient_phone: string | null;
  }>(
    `SELECT id, code, amount_santim, personal_message, recipient_email, recipient_phone
     FROM gift_cards
     WHERE status = 'issued' AND scheduled_delivery_at IS NOT NULL AND scheduled_delivery_at <= now()`
  );
  for (const row of rows) {
    const deliveryMethod = row.recipient_email ? "email" : row.recipient_phone ? "sms" : "link";
    await deliverGiftCard(row.id, row.code, {
      deliveryMethod,
      recipientEmail: row.recipient_email ?? undefined,
      recipientPhone: row.recipient_phone ?? undefined,
      amountSantim: row.amount_santim,
      personalMessage: row.personal_message ?? undefined,
    });
    await pool.query(`UPDATE gift_cards SET scheduled_delivery_at = NULL WHERE id = $1`, [row.id]);
  }
}

export async function getGiftCardPreview(code: string): Promise<GiftCardPreview | null> {
  const { rows } = await pool.query<{
    code: string;
    amount_santim: number;
    design_theme: GiftCardPreview["designTheme"];
    personal_message: string | null;
    purchaser_display_name: string | null;
    status: GiftCardPreview["status"];
    expires_at: string;
  }>(
    `SELECT gc.code, gc.amount_santim, gc.design_theme, gc.personal_message,
            u.display_name AS purchaser_display_name, gc.status, gc.expires_at
     FROM gift_cards gc
     LEFT JOIN users u ON u.id = gc.purchaser_id
     WHERE gc.code = $1`,
    [code]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    code: row.code,
    amountSantim: row.amount_santim,
    designTheme: row.design_theme,
    personalMessage: row.personal_message,
    purchaserDisplayName: row.purchaser_display_name,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function redeemGiftCard(userId: string, code: string): Promise<{ amountSantim: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: string; amount_santim: number; status: string; expires_at: string }>(
      `SELECT id, amount_santim, status, expires_at FROM gift_cards WHERE code = $1 FOR UPDATE`,
      [code]
    );
    const card = rows[0];
    if (!card) throw new AppError(404, "Gift card not found");
    if (card.status === "redeemed") throw new AppError(400, "This gift card has already been redeemed");
    if (card.status === "cancelled") throw new AppError(400, "This gift card was cancelled");
    if (card.status === "expired" || new Date(card.expires_at) < new Date()) {
      if (card.status !== "expired") await client.query(`UPDATE gift_cards SET status = 'expired' WHERE id = $1`, [card.id]);
      throw new AppError(400, "This gift card has expired");
    }

    const platformWalletId = await getPlatformWalletId(client);
    const recipientWalletId = await getUserWalletId(client, userId);

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('gift_card', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = txRows[0]!.id;

    await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", card.amount_santim);
    await insertEntry(client, ledgerTransactionId, recipientWalletId, "credit", card.amount_santim);
    await applyBalanceDelta(client, platformWalletId, -card.amount_santim);
    await applyBalanceDelta(client, recipientWalletId, card.amount_santim);

    await client.query(
      `UPDATE gift_cards SET status = 'redeemed', redeemed_by = $1, redeemed_at = now() WHERE id = $2`,
      [userId, card.id]
    );

    await client.query("COMMIT");
    await notify(userId, "gift_card_received", "Gift card redeemed", {
      body: `${(card.amount_santim / 100).toFixed(2)} birr added to your wallet`,
      linkUrl: "/wallet",
    });
    return { amountSantim: card.amount_santim };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getMyGiftCards(purchaserId: string): Promise<MyGiftCard[]> {
  const { rows } = await pool.query<{
    id: string;
    code: string;
    amount_santim: number;
    design_theme: MyGiftCard["designTheme"];
    status: MyGiftCard["status"];
    recipient_phone: string | null;
    recipient_email: string | null;
    scheduled_delivery_at: string | null;
    expires_at: string;
    created_at: string;
  }>(
    `SELECT id, code, amount_santim, design_theme, status, recipient_phone, recipient_email,
            scheduled_delivery_at, expires_at, created_at
     FROM gift_cards WHERE purchaser_id = $1 ORDER BY created_at DESC`,
    [purchaserId]
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    amountSantim: row.amount_santim,
    designTheme: row.design_theme,
    status: row.status,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email,
    scheduledDeliveryAt: row.scheduled_delivery_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

// --- Admin ---

export async function listGiftCardsAdmin(status?: string): Promise<GiftCardAdminItem[]> {
  const { rows } = await pool.query<{
    id: string;
    code: string;
    amount_santim: number;
    design_theme: GiftCardAdminItem["designTheme"];
    purchaser_username: string | null;
    recipient_phone: string | null;
    recipient_email: string | null;
    status: GiftCardAdminItem["status"];
    redeemed_by_username: string | null;
    redeemed_at: string | null;
    expires_at: string;
    created_at: string;
  }>(
    `SELECT gc.id, gc.code, gc.amount_santim, gc.design_theme, pu.username AS purchaser_username,
            gc.recipient_phone, gc.recipient_email, gc.status, ru.username AS redeemed_by_username,
            gc.redeemed_at, gc.expires_at, gc.created_at
     FROM gift_cards gc
     LEFT JOIN users pu ON pu.id = gc.purchaser_id
     LEFT JOIN users ru ON ru.id = gc.redeemed_by
     WHERE ($1::text IS NULL OR gc.status = $1)
     ORDER BY gc.created_at DESC
     LIMIT 200`,
    [status ?? null]
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    amountSantim: row.amount_santim,
    designTheme: row.design_theme,
    purchaserUsername: row.purchaser_username,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email,
    status: row.status,
    redeemedByUsername: row.redeemed_by_username,
    redeemedAt: row.redeemed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

// Fraud signal: purchasers who've bought an unusual number of cards in the
// last 24h — not a scored ML system, just a real, cheap heuristic surfaced
// for a human to look at, same "flag for review, never auto-block" posture
// this codebase uses everywhere else (scanText, image moderation).
export async function listSuspiciousGiftCardPurchasers(): Promise<{ username: string; count: number }[]> {
  const { rows } = await pool.query<{ username: string; count: string }>(
    `SELECT u.username, count(*) AS count
     FROM gift_cards gc
     JOIN users u ON u.id = gc.purchaser_id
     WHERE gc.created_at >= now() - interval '24 hours'
     GROUP BY u.username
     HAVING count(*) > 5
     ORDER BY count(*) DESC`
  );
  return rows.map((row) => ({ username: row.username, count: Number(row.count) }));
}

// Manual cancellation with ledger reversal — only for an unredeemed card
// (a redeemed one already moved real money into the recipient's wallet;
// reversing that is a manual adjustment, not a gift-card cancellation).
export async function cancelGiftCard(adminId: string, giftCardId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ amount_santim: number; status: string; purchaser_id: string | null }>(
      `SELECT amount_santim, status, purchaser_id FROM gift_cards WHERE id = $1 FOR UPDATE`,
      [giftCardId]
    );
    const card = rows[0];
    if (!card) throw new AppError(404, "Gift card not found");
    if (card.status !== "issued") throw new AppError(400, "Only an unredeemed gift card can be cancelled");
    if (!card.purchaser_id) throw new AppError(400, "Gift card has no purchaser to refund");

    const platformWalletId = await getPlatformWalletId(client);
    const purchaserWalletId = await getUserWalletId(client, card.purchaser_id);

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('refund', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = txRows[0]!.id;

    await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", card.amount_santim);
    await insertEntry(client, ledgerTransactionId, purchaserWalletId, "credit", card.amount_santim);
    await applyBalanceDelta(client, platformWalletId, -card.amount_santim);
    await applyBalanceDelta(client, purchaserWalletId, card.amount_santim);

    await client.query(`UPDATE gift_cards SET status = 'cancelled' WHERE id = $1`, [giftCardId]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await logAdminAction(adminId, "gift_card.cancel", "gift_card", giftCardId);
}
