import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { completeTopupFromWebhook, initiateTopup } from "../wallet/service.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getSubscriptionTierId,
  getWalletBalance,
  type TestUser,
} from "../test/fixtures.js";
import { cancelSubscription, renewSubscriptions, subscribe } from "./service.js";

const createdUserIds: string[] = [];

async function fundWallet(userId: string, amountSantim: number): Promise<void> {
  const { reference } = await initiateTopup(userId, amountSantim);
  await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: amountSantim, currency: "ETB" });
}

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function getSubscriptionRow(
  id: string
): Promise<{ status: string; ledger_transaction_id: string; expires_at: string }> {
  const { rows } = await pool.query<{ status: string; ledger_transaction_id: string; expires_at: string }>(
    `SELECT status, ledger_transaction_id, expires_at FROM subscriptions WHERE id = $1`,
    [id]
  );
  return rows[0]!;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("subscribe", () => {
  it("charges the subscriber and splits revenue by the creator's revenue_share_bps", async () => {
    const creator = await trackUser(await createTestCreator(7000)); // 70% to creator
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);

    const tierId = await getSubscriptionTierId("Tier 1"); // 10,000 santim
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });

    expect(result.tierName).toBe("Tier 1");
    expect(await getWalletBalance(subscriber.walletId)).toBe(90_000);
    expect(await getWalletBalance(creator.walletId)).toBe(7_000); // 70% of 10,000

    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM subscriptions WHERE id = $1`, [result.id]);
    expect(rows).toHaveLength(1);

    const sub = await getSubscriptionRow(result.id);
    await assertTransactionBalanced(sub.ledger_transaction_id);
  });

  it("rejects subscribing to yourself", async () => {
    const creator = await trackUser(await createTestCreator());
    const tierId = await getSubscriptionTierId("Tier 1");

    await expect(subscribe(creator.id, { creatorId: creator.id, tierId })).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects with insufficient balance and leaves the subscriber unfunded", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    const tierId = await getSubscriptionTierId("Tier 3"); // 50,000 santim — more than the subscriber has

    await expect(subscribe(subscriber.id, { creatorId: creator.id, tierId })).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
    expect(await getWalletBalance(subscriber.walletId)).toBe(0);

    const { rows } = await pool.query(`SELECT 1 FROM subscriptions WHERE subscriber_id = $1`, [subscriber.id]);
    expect(rows).toHaveLength(0);
  });

  it("404s for an unknown tier id", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);

    await expect(
      subscribe(subscriber.id, { creatorId: creator.id, tierId: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("cancelSubscription", () => {
  it("marks an active subscription cancelled", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);
    const tierId = await getSubscriptionTierId("Tier 1");
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });

    await cancelSubscription(subscriber.id, result.id);

    const sub = await getSubscriptionRow(result.id);
    expect(sub.status).toBe("cancelled");
  });

  it("is idempotent — cancelling twice does not error", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);
    const tierId = await getSubscriptionTierId("Tier 1");
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });

    await cancelSubscription(subscriber.id, result.id);
    await expect(cancelSubscription(subscriber.id, result.id)).resolves.toBeUndefined();
  });

  it("404s for a subscription belonging to a different subscriber", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    const otherViewer = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);
    const tierId = await getSubscriptionTierId("Tier 1");
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });

    await expect(cancelSubscription(otherViewer.id, result.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});

describe("renewSubscriptions", () => {
  // renewSubscriptions() only picks up rows whose expires_at is already in
  // the past — subscribe() always sets it a month out, so these tests
  // backdate expires_at directly rather than waiting a month, same as any
  // renewal-job test would need to.
  async function backdateExpiry(subscriptionId: string): Promise<void> {
    await pool.query(`UPDATE subscriptions SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      subscriptionId,
    ]);
  }

  it("charges again and extends expires_at on a successful renewal", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 100_000);
    const tierId = await getSubscriptionTierId("Tier 1"); // 10,000 santim
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });
    await backdateExpiry(result.id);

    const balanceAfterFirstCharge = await getWalletBalance(subscriber.walletId);
    await renewSubscriptions();

    expect(await getWalletBalance(subscriber.walletId)).toBe(balanceAfterFirstCharge - 10_000);
    const sub = await getSubscriptionRow(result.id);
    expect(sub.status).toBe("active");
    expect(new Date(sub.expires_at).getTime()).toBeGreaterThan(Date.now());
    await assertTransactionBalanced(sub.ledger_transaction_id);
  });

  it("moves to payment_failed (grace period) on the first missed renewal, not straight to cancelled", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    // Fund just enough for the initial charge, nothing left for renewal.
    await fundWallet(subscriber.id, 10_000);
    const tierId = await getSubscriptionTierId("Tier 1");
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });
    await backdateExpiry(result.id);

    await renewSubscriptions();

    const sub = await getSubscriptionRow(result.id);
    expect(sub.status).toBe("payment_failed");
  });

  it("cancels for real on a second consecutive missed renewal", async () => {
    const creator = await trackUser(await createTestCreator());
    const subscriber = await trackUser(await createTestViewer());
    await fundWallet(subscriber.id, 10_000);
    const tierId = await getSubscriptionTierId("Tier 1");
    const result = await subscribe(subscriber.id, { creatorId: creator.id, tierId });
    await backdateExpiry(result.id);

    await renewSubscriptions(); // -> payment_failed (grace period)
    await backdateExpiry(result.id); // simulate the grace period also elapsing
    await renewSubscriptions(); // -> cancelled

    const sub = await getSubscriptionRow(result.id);
    expect(sub.status).toBe("cancelled");
  });

  it("processes one subscriber's failed renewal without affecting another's successful one", async () => {
    const creator = await trackUser(await createTestCreator());
    const poorSubscriber = await trackUser(await createTestViewer());
    const richSubscriber = await trackUser(await createTestViewer());
    await fundWallet(poorSubscriber.id, 10_000); // enough for one charge only
    await fundWallet(richSubscriber.id, 100_000);
    const tierId = await getSubscriptionTierId("Tier 1");

    const poorResult = await subscribe(poorSubscriber.id, { creatorId: creator.id, tierId });
    const richResult = await subscribe(richSubscriber.id, { creatorId: creator.id, tierId });
    await backdateExpiry(poorResult.id);
    await backdateExpiry(richResult.id);

    await renewSubscriptions();

    expect((await getSubscriptionRow(poorResult.id)).status).toBe("payment_failed");
    const richSub = await getSubscriptionRow(richResult.id);
    expect(richSub.status).toBe("active");
    expect(new Date(richSub.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
