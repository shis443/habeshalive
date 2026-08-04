import { condition, defineSignal, log, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type {
  ApprovePayoutSignal,
  ChapaTransferOutcomeSignal,
  PayoutWorkflowInput,
  PayoutWorkflowResult,
  RejectPayoutSignal,
} from "./types.js";

// Activities get their own retry policy (Temporal's default: retries with
// exponential backoff until this timeout) — this is what actually closes
// the crash-mid-flight gap docs/temporal-migration-plan.md identified: a
// transient failure (DB blip, Chapa timeout) is retried automatically
// instead of the whole payout silently stalling.
const { reserveFunds, reverseFunds, initiateChapaTransfer, markPaid, resolveBankCode, markApproved } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 5 },
  });

export const approvePayoutSignal = defineSignal<[ApprovePayoutSignal]>("approvePayout");
export const rejectPayoutSignal = defineSignal<[RejectPayoutSignal]>("rejectPayout");
export const chapaTransferOutcomeSignal = defineSignal<[ChapaTransferOutcomeSignal]>("chapaTransferOutcome");

// Real money workflow — see docs/temporal-migration-plan.md for the full
// risk audit and decomposition this implements. Every step below already
// existed as tested application logic in wallet/service.ts before this;
// what Temporal adds is that this function's progress (which activity
// completed, which signal arrived) is durably persisted, so a worker
// process crash at any point resumes from exactly where it left off
// instead of losing the in-flight payout state.
type ApprovalDecision =
  | { kind: "approved"; adminUserId: string }
  | { kind: "rejected"; adminUserId: string; reason: string };

export async function PayoutWorkflow(input: PayoutWorkflowInput): Promise<PayoutWorkflowResult> {
  // Discriminated union with an explicit `kind` tag, not a plain
  // ApprovePayoutSignal | RejectPayoutSignal | "pending" union — TS can't
  // reliably narrow a mutable `let` that's reassigned inside signal-handler
  // closures across an `await condition(...)` boundary, since it can't
  // prove the handler didn't run again between the check and the use. A
  // discriminant tag plus taking a local const snapshot right after the
  // await sidesteps that instead of fighting the type checker.
  let decision: ApprovalDecision | undefined;
  let chapaOutcome: ChapaTransferOutcomeSignal | undefined;

  setHandler(approvePayoutSignal, (signal) => {
    decision ??= { kind: "approved", adminUserId: signal.adminUserId };
  });
  setHandler(rejectPayoutSignal, (signal) => {
    decision ??= { kind: "rejected", adminUserId: signal.adminUserId, reason: signal.reason };
  });
  setHandler(chapaTransferOutcomeSignal, (signal) => {
    chapaOutcome = signal;
  });

  const resolvedBankCode = await resolveBankCode(input.method, input.bankCode);
  const { payoutId } = await reserveFunds({ ...input, bankCode: resolvedBankCode });

  if (input.requiresManualApproval) {
    // No timeout on this wait by design — an admin review queue item
    // should sit until a human acts on it, not auto-expire. The funds
    // stay reserved (debited from the creator's spendable balance) for
    // exactly as long as the original inline implementation held them:
    // indefinitely, until approvePayout/rejectPayout was called.
    await condition(() => decision !== undefined);
    const outcome = decision!;
    if (outcome.kind === "rejected") {
      await reverseFunds(payoutId, outcome.reason);
      log.info("Payout rejected", { payoutId, adminUserId: outcome.adminUserId });
      return { status: "failed", failureReason: outcome.reason };
    }
    await markApproved(payoutId, outcome.adminUserId);
  }

  try {
    await initiateChapaTransfer({
      payoutId,
      destination: input.destination,
      accountName: input.displayName,
      amountSantim: input.amountSantim,
      bankCode: resolvedBankCode,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Transfer initiation failed";
    await reverseFunds(payoutId, reason);
    return { status: "failed", failureReason: reason };
  }

  // Chapa's transfer-status webhook (wallet/routes.ts's
  // /webhooks/chapa-transfer) signals this workflow instead of writing
  // directly to the payouts table now — see client.ts's
  // signalChapaTransferOutcome. 24h backstop: if Chapa never calls back
  // (an integration failure on their end, not something retrying the
  // activity above would fix), this stops the workflow from waiting
  // forever with funds indefinitely reserved.
  const arrived = await condition(() => chapaOutcome !== undefined, "24 hours");
  if (!arrived) {
    await reverseFunds(payoutId, "No transfer status received from Chapa within 24 hours");
    return { status: "failed", failureReason: "Chapa webhook timeout" };
  }

  if (chapaOutcome!.success) {
    await markPaid(payoutId, input.amountSantim, input.creatorId);
    return { status: "paid" };
  }
  const reason = chapaOutcome!.reason ?? "Chapa reported transfer failure";
  await reverseFunds(payoutId, reason);
  return { status: "failed", failureReason: reason };
}
