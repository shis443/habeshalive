import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../common/db.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  fundCreatorEarnings,
  getWalletBalance,
  type TestCreator,
} from "../../test/fixtures.js";
import {
  initiateChapaTransfer,
  markApproved,
  markPaid,
  reserveFunds,
  resolveBankCode,
  reverseFunds,
} from "./activities.js";
import type { PayoutWorkflowInput } from "./types.js";

// No test file exercised these before this pass (flagged in 2026-09-05's
// health audit) — a real gap, since these are the actual payout money
// movements (Temporal only orchestrates calling them; the ledger effects
// live entirely here, same logic wallet/service.ts's pre-Temporal inline
// requestPayout/approvePayout used). CHAPA_SECRET_KEY is unset in this
// test environment, so chapaPayoutClient resolves to its deterministic
// stub (chapa-client.ts) — no real Chapa API is called.

const createdUserIds: string[] = [];

async function trackCreator(creator: TestCreator): Promise<TestCreator> {
  createdUserIds.push(creator.id);
  return creator;
}

function buildInput(overrides: Partial<PayoutWorkflowInput> & { creatorId: string }): PayoutWorkflowInput {
  return {
    payoutId: randomUUID(),
    amountSantim: 10_000,
    method: "telebirr",
    destination: "+251911234567",
    bankCode: "",
    displayName: "Test Creator",
    requiresManualApproval: false,
    ...overrides,
  };
}

async function getPayout(
  payoutId: string
): Promise<{ status: string; ledger_transaction_id: string; failure_reason: string | null } | undefined> {
  const { rows } = await pool.query<{ status: string; ledger_transaction_id: string; failure_reason: string | null }>(
    `SELECT status, ledger_transaction_id, failure_reason FROM payouts WHERE id = $1`,
    [payoutId]
  );
  return rows[0];
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("reserveFunds", () => {
  it("debits the creator, credits the platform, and creates a processing payout", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });

    const result = await reserveFunds(input);

    expect(result.payoutId).toBe(input.payoutId);
    expect(await getWalletBalance(creator.walletId)).toBe(30_000);
    const payout = await getPayout(input.payoutId);
    expect(payout?.status).toBe("processing");
    await assertTransactionBalanced(payout!.ledger_transaction_id);
  });

  it("creates a pending_review payout instead of processing when manual approval is required", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000, requiresManualApproval: true });

    await reserveFunds(input);

    expect((await getPayout(input.payoutId))?.status).toBe("pending_review");
  });

  it("rejects with insufficient balance and reserves nothing", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 5_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });

    await expect(reserveFunds(input)).rejects.toThrow(/Insufficient withdrawable balance/);
    expect(await getWalletBalance(creator.walletId)).toBe(5_000);
    expect(await getPayout(input.payoutId)).toBeUndefined();
  });

  it("is idempotent — a retried call with the same payoutId does not reserve funds twice", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });

    await reserveFunds(input);
    const balanceAfterFirstCall = await getWalletBalance(creator.walletId);
    const result = await reserveFunds(input); // Temporal's at-least-once retry, same payoutId

    expect(result.payoutId).toBe(input.payoutId);
    expect(await getWalletBalance(creator.walletId)).toBe(balanceAfterFirstCall); // not double-debited
  });
});

describe("reverseFunds", () => {
  it("refunds the creator and marks the payout failed", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });
    await reserveFunds(input);
    const balanceAfterReserve = await getWalletBalance(creator.walletId);

    await reverseFunds(input.payoutId, "Bank rejected transfer");

    expect(await getWalletBalance(creator.walletId)).toBe(balanceAfterReserve + 20_000);
    const payout = await getPayout(input.payoutId);
    expect(payout?.status).toBe("failed");
    expect(payout?.failure_reason).toBe("Bank rejected transfer");
    await assertTransactionBalanced(payout!.ledger_transaction_id);
  });

  it("is idempotent — reversing an already-failed payout does not double-refund", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });
    await reserveFunds(input);

    await reverseFunds(input.payoutId, "Bank rejected transfer");
    const balanceAfterFirstReversal = await getWalletBalance(creator.walletId);
    await reverseFunds(input.payoutId, "Retried after crash"); // Temporal at-least-once retry

    expect(await getWalletBalance(creator.walletId)).toBe(balanceAfterFirstReversal);
  });

  it("is a no-op on an already-paid payout — never reverses a completed transfer", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });
    await reserveFunds(input);
    await markPaid(input.payoutId, input.amountSantim, creator.id);
    const balanceAfterPaid = await getWalletBalance(creator.walletId);

    await reverseFunds(input.payoutId, "should be ignored");

    expect(await getWalletBalance(creator.walletId)).toBe(balanceAfterPaid);
    expect((await getPayout(input.payoutId))?.status).toBe("paid");
  });
});

describe("markApproved / markPaid", () => {
  it("markApproved records the approving admin and moves to processing", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000, requiresManualApproval: true });
    await reserveFunds(input);
    const admin = await trackCreator(await createTestCreator());

    await markApproved(input.payoutId, admin.id);

    const { rows } = await pool.query<{ status: string; approved_by: string }>(
      `SELECT status, approved_by FROM payouts WHERE id = $1`,
      [input.payoutId]
    );
    expect(rows[0]?.status).toBe("processing");
    expect(rows[0]?.approved_by).toBe(admin.id);
  });

  it("markPaid is idempotent — marking an already-paid payout twice does not error", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });
    await reserveFunds(input);

    await markPaid(input.payoutId, input.amountSantim, creator.id);
    await expect(markPaid(input.payoutId, input.amountSantim, creator.id)).resolves.toBeUndefined();
    expect((await getPayout(input.payoutId))?.status).toBe("paid");
  });
});

describe("initiateChapaTransfer", () => {
  it("persists the stub client's reference and is idempotent on retry", async () => {
    const creator = await trackCreator(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 50_000));
    const input = buildInput({ creatorId: creator.id, amountSantim: 20_000 });
    await reserveFunds(input);

    const first = await initiateChapaTransfer({
      payoutId: input.payoutId,
      destination: input.destination,
      accountName: input.displayName,
      amountSantim: input.amountSantim,
      bankCode: "stub-bank-code",
    });
    expect(first.chapaReference).toBe(`stub_transfer_${input.payoutId}`);

    const { rows } = await pool.query<{ chapa_reference: string }>(
      `SELECT chapa_reference FROM payouts WHERE id = $1`,
      [input.payoutId]
    );
    expect(rows[0]?.chapa_reference).toBe(first.chapaReference);

    // Retried call — short-circuits on the already-persisted reference
    // rather than calling the client (and, on the real client, initiating
    // a second transfer) again.
    const second = await initiateChapaTransfer({
      payoutId: input.payoutId,
      destination: input.destination,
      accountName: input.displayName,
      amountSantim: input.amountSantim,
      bankCode: "stub-bank-code",
    });
    expect(second.chapaReference).toBe(first.chapaReference);
  });
});

describe("resolveBankCode", () => {
  it("resolves telebirr's bank code via the client, ignoring whatever was passed in", async () => {
    expect(await resolveBankCode("telebirr", "")).toBe("stub-bank-code");
  });

  it("passes a real bank's code through unchanged, without calling the client", async () => {
    expect(await resolveBankCode("bank", "some-real-bank-code")).toBe("some-real-bank-code");
  });
});
