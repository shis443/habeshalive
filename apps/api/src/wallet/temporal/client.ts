import { env } from "../../common/env.js";
import { getTemporalClient, isTemporalConfigured } from "../../common/temporal-client.js";
import type { PayoutWorkflowInput } from "./types.js";
import { approvePayoutSignal, chapaTransferOutcomeSignal, PayoutWorkflow, rejectPayoutSignal } from "./workflow.js";

export { isTemporalConfigured };

// workflowId = payoutId, deliberately — Temporal's default
// WorkflowIDReusePolicy (RejectDuplicate) means starting a workflow with
// an ID that's already running or already completed fails/returns the
// existing handle rather than starting a second one. That's the actual
// idempotency mechanism the BIRQ ask for "idempotency and crash recovery"
// maps to: a caller that retries POST /wallet/payouts with a client-
// generated payoutId it already submitted can't accidentally start the
// disbursement twice.
export async function startPayoutWorkflow(input: PayoutWorkflowInput): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start(PayoutWorkflow, {
    workflowId: input.payoutId,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    args: [input],
  });
}

export async function signalApprove(payoutId: string, adminUserId: string): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(payoutId).signal(approvePayoutSignal, { adminUserId });
}

export async function signalReject(payoutId: string, adminUserId: string, reason: string): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(payoutId).signal(rejectPayoutSignal, { adminUserId, reason });
}

export async function signalChapaTransferOutcome(
  payoutId: string,
  outcome: { success: boolean; reason?: string }
): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(payoutId).signal(chapaTransferOutcomeSignal, outcome);
}
