import { z } from "zod";

// Module 4 — Watch-to-Earn (apps/api/src/points/service.ts). "Redeem for
// airtime" from the original spec isn't implemented — there's no real
// telecom carrier API partnership behind it (same reasoning as Module
// 2's Telebirr/CBE Birr not getting a fake client) — redemption instead
// credits real, spendable wallet balance.
export const POINTS_PER_HEARTBEAT = 10;
export const HEARTBEAT_INTERVAL_SECONDS = 60;
export const DAILY_POINT_CAP = 500;
export const POINTS_PER_SANTIM = 10; // 10 points = 1 santim = 0.01 ETB

export const pointsBalanceSchema = z.object({
  balance: z.number().int().nonnegative(),
});
export type PointsBalance = z.infer<typeof pointsBalanceSchema>;

export const watchHeartbeatSchema = z.object({
  streamId: z.string().uuid(),
});
export type WatchHeartbeatInput = z.infer<typeof watchHeartbeatSchema>;

export const watchHeartbeatResponseSchema = z.object({
  awarded: z.number().int().nonnegative(),
  balance: z.number().int().nonnegative(),
  dailyCapReached: z.boolean(),
});
export type WatchHeartbeatResponse = z.infer<typeof watchHeartbeatResponseSchema>;

export const redeemPointsSchema = z.object({
  points: z.number().int().positive(),
});
export type RedeemPointsInput = z.infer<typeof redeemPointsSchema>;

export const redeemPointsResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  creditedSantim: z.number().int().positive(),
});
export type RedeemPointsResponse = z.infer<typeof redeemPointsResponseSchema>;
