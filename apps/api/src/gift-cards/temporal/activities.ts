import { pool } from "../../common/db.js";
import { emailGateway } from "../../auth/email-gateway.js";
import { smsGateway } from "../../auth/sms-gateway.js";
import { redemptionUrl } from "../service.js";
import type { GiftCardDeliveryInput } from "./types.js";

// Idempotent by checking scheduled_delivery_at first: once a card has been
// delivered, markDelivered (below) clears that column — a retried call
// (Temporal's at-least-once activity execution, or a crash between this
// completing and Temporal recording it) sees it already NULL and skips the
// send entirely instead of emailing/texting the recipient twice. This is
// the actual fix for the duplicate-send bug identified in
// docs/temporal-migration-plan.md: the pre-Temporal sendScheduledGiftCards
// had no guard between "send succeeded" and "mark sent" surviving a crash.
export async function sendGiftCardDelivery(input: GiftCardDeliveryInput): Promise<void> {
  const { rows } = await pool.query<{ scheduled_delivery_at: string | null }>(
    `SELECT scheduled_delivery_at FROM gift_cards WHERE id = $1`,
    [input.giftCardId]
  );
  if (!rows[0]) throw new Error(`Unknown gift card ${input.giftCardId}`);
  if (rows[0].scheduled_delivery_at === null) return; // already delivered — no-op

  const amountBirr = (input.amountSantim / 100).toFixed(2);
  const url = redemptionUrl(input.code);
  if (input.deliveryMethod === "email" && input.recipientEmail) {
    await emailGateway.sendGiftCard(input.recipientEmail, url, amountBirr, input.personalMessage);
  } else if (input.deliveryMethod === "sms" && input.recipientPhone) {
    await smsGateway.sendGiftCard(input.recipientPhone, url, amountBirr);
  }
  // "link" delivery needs no send, same as the original inline logic.
}

export async function markDelivered(giftCardId: string): Promise<void> {
  await pool.query(`UPDATE gift_cards SET scheduled_delivery_at = NULL WHERE id = $1`, [giftCardId]);
}
