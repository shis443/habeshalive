import type { PlatformConfig, UpdatePlatformConfigInput } from "@habeshalive/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";

interface ConfigRow {
  boost_price_santim: number;
  boost_duration_ms: number;
  updated_at: string;
  updated_by_username: string | null;
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const { rows } = await pool.query<ConfigRow>(
    `SELECT pc.boost_price_santim, pc.boost_duration_ms, pc.updated_at, u.username AS updated_by_username
     FROM platform_config pc
     LEFT JOIN users u ON u.id = pc.updated_by
     WHERE pc.id = TRUE`
  );
  const row = rows[0]!;
  return {
    boostPriceSantim: row.boost_price_santim,
    boostDurationMs: row.boost_duration_ms,
    updatedAt: row.updated_at,
    updatedByUsername: row.updated_by_username,
  };
}

// The single source boostStream() (streams/service.ts) actually charges
// against — separate from getPlatformConfig() above so a hot write path
// isn't dragging in the admin username join it doesn't need.
export async function getBoostPricing(): Promise<{ priceSantim: number; durationMs: number }> {
  const { rows } = await pool.query<{ boost_price_santim: number; boost_duration_ms: number }>(
    `SELECT boost_price_santim, boost_duration_ms FROM platform_config WHERE id = TRUE`
  );
  return { priceSantim: rows[0]!.boost_price_santim, durationMs: rows[0]!.boost_duration_ms };
}

export async function updatePlatformConfig(adminId: string, input: UpdatePlatformConfigInput): Promise<PlatformConfig> {
  await pool.query(
    `UPDATE platform_config SET boost_price_santim = $1, boost_duration_ms = $2, updated_at = now(), updated_by = $3
     WHERE id = TRUE`,
    [input.boostPriceSantim, input.boostDurationMs, adminId]
  );
  await logAdminAction(adminId, "config.update", "platform_config", null, { metadata: input });
  return getPlatformConfig();
}
