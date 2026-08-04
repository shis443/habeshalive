import { env } from "../../common/env.js";
import { getTemporalClient } from "../../common/temporal-client.js";
import type { GiftCardDeliveryInput } from "./types.js";
import { GiftCardDeliveryWorkflow } from "./workflow.js";

// workflowId = giftCardId — same reject-duplicate idempotency mechanism as
// wallet/temporal/client.ts's startPayoutWorkflow: two overlapping
// sendScheduledGiftCards ticks (or a retried call) that both pick up the
// same not-yet-delivered card can't start two deliveries for it.
export async function startGiftCardDeliveryWorkflow(input: GiftCardDeliveryInput): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start(GiftCardDeliveryWorkflow, {
    workflowId: input.giftCardId,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    args: [input],
  });
}
