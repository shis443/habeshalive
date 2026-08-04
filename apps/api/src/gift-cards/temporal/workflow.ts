import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { GiftCardDeliveryInput } from "./types.js";

const { sendGiftCardDelivery, markDelivered } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

// Deliberately simple compared to PayoutWorkflow (../../wallet/temporal/
// workflow.js) — there's no external money movement or manual-review wait
// here, just two steps that need to survive a crash between them without
// re-sending. See docs/temporal-migration-plan.md for the specific bug
// this closes: the pre-Temporal sendScheduledGiftCards could email/text a
// recipient twice if the process died between the send succeeding and the
// DB write that marks it sent.
export async function GiftCardDeliveryWorkflow(input: GiftCardDeliveryInput): Promise<void> {
  await sendGiftCardDelivery(input);
  await markDelivered(input.giftCardId);
}
