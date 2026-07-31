import { z } from "zod";

// Real illustrated card art per occasion isn't available yet (same
// art-blocked-not-code-blocked situation as Gursha themes and the avatar
// system) — these are CSS-styled placeholders, one distinct color/icon per
// occasion, swappable for real assets later with no schema change.
export const giftCardDesignThemeSchema = z.enum([
  "enkutatash",
  "genna",
  "timket",
  "fasika",
  "meskel",
  "birthday",
  "wedding",
  "graduation",
  "generic_celebration",
]);
export type GiftCardDesignTheme = z.infer<typeof giftCardDesignThemeSchema>;

export const giftCardDeliveryMethodSchema = z.enum(["sms", "email", "link"]);
export type GiftCardDeliveryMethod = z.infer<typeof giftCardDeliveryMethodSchema>;

export const purchaseGiftCardSchema = z
  .object({
    amountSantim: z.number().int().positive(),
    designTheme: giftCardDesignThemeSchema,
    personalMessage: z.string().max(300).optional(),
    deliveryMethod: giftCardDeliveryMethodSchema,
    recipientPhone: z.string().max(20).optional(),
    recipientEmail: z.string().email().optional(),
    scheduledDeliveryAt: z.string().optional(),
  })
  .refine((input) => input.deliveryMethod !== "sms" || !!input.recipientPhone, {
    message: "recipientPhone is required for SMS delivery",
    path: ["recipientPhone"],
  })
  .refine((input) => input.deliveryMethod !== "email" || !!input.recipientEmail, {
    message: "recipientEmail is required for email delivery",
    path: ["recipientEmail"],
  });
export type PurchaseGiftCardInput = z.infer<typeof purchaseGiftCardSchema>;

export const purchaseGiftCardResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  redemptionUrl: z.string(),
});
export type PurchaseGiftCardResponse = z.infer<typeof purchaseGiftCardResponseSchema>;

export const myGiftCardSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  amountSantim: z.number().int(),
  designTheme: giftCardDesignThemeSchema,
  status: z.enum(["issued", "redeemed", "expired", "cancelled"]),
  recipientPhone: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  scheduledDeliveryAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type MyGiftCard = z.infer<typeof myGiftCardSchema>;

// What the redemption page shows BEFORE the viewer redeems — no purchaser
// wallet/account details, just enough to preview the card.
export const giftCardPreviewSchema = z.object({
  code: z.string(),
  amountSantim: z.number().int(),
  designTheme: giftCardDesignThemeSchema,
  personalMessage: z.string().nullable(),
  purchaserDisplayName: z.string().nullable(),
  status: z.enum(["issued", "redeemed", "expired", "cancelled"]),
  expiresAt: z.string(),
});
export type GiftCardPreview = z.infer<typeof giftCardPreviewSchema>;

export const redeemGiftCardSchema = z.object({
  code: z.string().min(1),
});
export type RedeemGiftCardInput = z.infer<typeof redeemGiftCardSchema>;

// --- Admin ---

export const giftCardAdminItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  amountSantim: z.number().int(),
  designTheme: giftCardDesignThemeSchema,
  purchaserUsername: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  status: z.enum(["issued", "redeemed", "expired", "cancelled"]),
  redeemedByUsername: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type GiftCardAdminItem = z.infer<typeof giftCardAdminItemSchema>;
