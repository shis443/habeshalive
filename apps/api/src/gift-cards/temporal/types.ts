// Workflow code runs in Temporal's deterministic sandbox — see
// wallet/temporal/types.ts's comment for why this file stays free of any
// non-type imports.

export interface GiftCardDeliveryInput {
  giftCardId: string; // also used as the Temporal workflow ID — see client.ts.
  code: string;
  amountSantim: number;
  personalMessage?: string;
  deliveryMethod: "email" | "sms" | "link";
  recipientEmail?: string;
  recipientPhone?: string;
}
