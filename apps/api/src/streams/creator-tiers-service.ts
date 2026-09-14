import type { CreatorTier, CreatorTierName } from "@birq/shared";
import { getCreatorTierThresholds, type CreatorTierThresholds } from "../admin/config-service.js";
import { pool } from "../common/db.js";

// Excludes "none" — that's the absence of a tier, never a threshold key.
type ThresholdTier = Exclude<CreatorTierName, "none">;
const TIER_ORDER: ThresholdTier[] = ["bronze", "silver", "gold", "partner"];

// A tier requires BOTH thresholds cleared (not either) — see
// db/migrations/0067_creator_tiers.sql's own comment on why: "real
// audience AND real support," not just one signal alone.
function computeTier(
  watchHours: number,
  giftVolumeSantim: number,
  thresholds: CreatorTierThresholds
): CreatorTierName {
  let tier: CreatorTierName = "none";
  for (const candidate of TIER_ORDER) {
    const t = thresholds[candidate];
    if (watchHours >= t.watchHours && giftVolumeSantim >= t.giftVolumeSantim) {
      tier = candidate;
    }
  }
  return tier;
}

interface WatchHoursRow {
  creator_id: string;
  viewer_seconds: string;
}

interface GiftVolumeRow {
  creator_id: string;
  total: string;
}

// Periodic sweep (server.ts) — recomputes every creator's LIFETIME watch
// hours delivered and gift volume received, same raw-plus-rolled-up
// pattern as analytics-service.ts/admin's leaderboard, just all-time
// totals instead of a bounded window. Reaching 'partner' auto-sets
// creator_profiles.is_anchor_creator = TRUE in the same transaction — one
// source of truth for the real perk (extended VOD retention already keys
// off that flag), not a second parallel "is this creator special" switch.
export async function recomputeCreatorTiers(): Promise<void> {
  const thresholds = await getCreatorTierThresholds();

  const [watchRows, giftRows] = await Promise.all([
    pool.query<WatchHoursRow>(
      `SELECT s.creator_id,
              COALESCE(SUM(sv.viewer_seconds), 0) + COALESCE(SUM(swtd.viewer_seconds), 0) AS viewer_seconds
       FROM streams s
       JOIN creator_profiles cp ON cp.user_id = s.creator_id
       LEFT JOIN (
         SELECT stream_id, SUM(viewer_count) * 60 AS viewer_seconds
         FROM stream_viewer_samples GROUP BY stream_id
       ) sv ON sv.stream_id = s.id
       LEFT JOIN (
         SELECT stream_id, SUM(viewer_seconds) AS viewer_seconds
         FROM stream_watch_time_daily GROUP BY stream_id
       ) swtd ON swtd.stream_id = s.id
       GROUP BY s.creator_id`
    ),
    pool.query<GiftVolumeRow>(
      `SELECT w.owner_id AS creator_id, SUM(le.amount_santim) AS total
       FROM wallets w
       JOIN creator_profiles cp ON cp.user_id = w.owner_id
       JOIN ledger_entries le ON le.wallet_id = w.id
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       WHERE w.owner_type = 'user' AND le.direction = 'credit' AND lt.type = 'gift'
       GROUP BY w.owner_id`
    ),
  ]);

  const watchHoursByCreator = new Map(watchRows.rows.map((r) => [r.creator_id, Number(r.viewer_seconds) / 3600]));
  const giftVolumeByCreator = new Map(giftRows.rows.map((r) => [r.creator_id, Number(r.total)]));
  const creatorIds = new Set([...watchHoursByCreator.keys(), ...giftVolumeByCreator.keys()]);

  for (const creatorId of creatorIds) {
    const watchHours = watchHoursByCreator.get(creatorId) ?? 0;
    const giftVolumeSantim = giftVolumeByCreator.get(creatorId) ?? 0;
    const tier = computeTier(watchHours, giftVolumeSantim, thresholds);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO creator_tiers (creator_id, tier, lifetime_watch_hours, lifetime_gift_volume_santim, computed_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (creator_id) DO UPDATE SET
           tier = EXCLUDED.tier,
           lifetime_watch_hours = EXCLUDED.lifetime_watch_hours,
           lifetime_gift_volume_santim = EXCLUDED.lifetime_gift_volume_santim,
           computed_at = EXCLUDED.computed_at`,
        [creatorId, tier, watchHours, giftVolumeSantim]
      );
      if (tier === "partner") {
        await client.query(`UPDATE creator_profiles SET is_anchor_creator = TRUE WHERE user_id = $1`, [creatorId]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

// Creator-facing read — own tier + progress toward the next one. A
// creator who has never streamed/received a gift (no creator_tiers row
// yet, sweep hasn't run for them) reads as 'none' with bronze as the
// next target, not an error.
export async function getCreatorTier(creatorId: string): Promise<CreatorTier> {
  const [{ rows }, thresholds, anchorRows] = await Promise.all([
    pool.query<{ tier: CreatorTierName; lifetime_watch_hours: string; lifetime_gift_volume_santim: string }>(
      `SELECT tier, lifetime_watch_hours, lifetime_gift_volume_santim FROM creator_tiers WHERE creator_id = $1`,
      [creatorId]
    ),
    getCreatorTierThresholds(),
    pool.query<{ is_anchor_creator: boolean }>(`SELECT is_anchor_creator FROM creator_profiles WHERE user_id = $1`, [
      creatorId,
    ]),
  ]);

  const row = rows[0];
  const tier: CreatorTierName = row?.tier ?? "none";
  const lifetimeWatchHours = row ? Number(row.lifetime_watch_hours) : 0;
  const lifetimeGiftVolumeSantim = row ? Number(row.lifetime_gift_volume_santim) : 0;

  const currentIndex = tier === "none" ? -1 : TIER_ORDER.indexOf(tier);
  const nextTier = currentIndex + 1 < TIER_ORDER.length ? TIER_ORDER[currentIndex + 1]! : null;

  return {
    tier,
    lifetimeWatchHours,
    lifetimeGiftVolumeSantim,
    nextTier,
    nextTierWatchHoursThreshold: nextTier ? thresholds[nextTier].watchHours : null,
    nextTierGiftVolumeSantimThreshold: nextTier ? thresholds[nextTier].giftVolumeSantim : null,
    isAnchorCreator: anchorRows.rows[0]?.is_anchor_creator ?? false,
  };
}
