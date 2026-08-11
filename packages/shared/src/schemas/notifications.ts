import { z } from "zod";

export const notificationTypeSchema = z.enum([
  "creator_live",
  "category_live",
  "gursha_received",
  "subscription_new",
  "subscription_renewed",
  "subscription_expiring",
  "payout_processed",
  "payout_failed",
  "moderation_action",
  "gift_card_received",
  "application_approved",
  "application_rejected",
  "ad_revenue_paid",
  "kyc_approved",
  "kyc_rejected",
  "donation_received",
  "ppv_purchase_received",
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  linkUrl: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const unreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});

export const notificationPreferencesSchema = z.object({
  liveAlerts: z.boolean(),
  gurshaReceived: z.boolean(),
  subscriptionEvents: z.boolean(),
  payoutEvents: z.boolean(),
  moderationEvents: z.boolean(),
  giftCardEvents: z.boolean(),
  marketing: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = notificationPreferencesSchema.partial();
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
