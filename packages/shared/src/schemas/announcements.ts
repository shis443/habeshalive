import { z } from "zod";

export const announcementSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  actionLabel: z.string().nullable(),
  actionUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const createAnnouncementSchema = z.object({
  body: z.string().min(1).max(280),
  actionLabel: z.string().min(1).max(40).optional(),
  actionUrl: z.string().url().optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const announcementAdminItemSchema = announcementSchema.extend({
  isActive: z.boolean(),
  createdByUsername: z.string(),
});
export type AnnouncementAdminItem = z.infer<typeof announcementAdminItemSchema>;
