import type { AdminGiftType, UpdateGiftTypeInput } from "@birq/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface GiftTypeRow {
  id: string;
  name: string;
  price_santim: number;
  animation_key: string;
  tier_key: AdminGiftType["tierKey"];
  is_active: boolean;
  category: string;
  creator_share_bps: number;
  available_from: string | null;
  available_until: string | null;
  regions: string[] | null;
}

function mapRow(row: GiftTypeRow): AdminGiftType {
  return {
    id: row.id,
    name: row.name,
    priceSantim: row.price_santim,
    animationKey: row.animation_key,
    tierKey: row.tier_key,
    isActive: row.is_active,
    category: row.category,
    creatorShareBps: row.creator_share_bps,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    regions: row.regions,
  };
}

// LEFT JOIN, unlike wallet/service.ts's listGiftTypes (viewer catalog,
// which only ever shows is_active rows) — a handful of retired gift_types
// rows predate gift_tier_id being required and have it NULL. An INNER
// JOIN here would silently drop them from the admin view entirely,
// meaning finance could never see or re-enable them.
const SELECT_GIFT_TYPE = `
  SELECT gt.id, gt.name, gt.price_santim, gt.animation_key, gtier.key AS tier_key,
         gt.is_active, gt.category, gt.creator_share_bps, gt.available_from,
         gt.available_until, gt.regions
  FROM gift_types gt LEFT JOIN gift_tiers gtier ON gtier.id = gt.gift_tier_id
`;

// Includes inactive and out-of-window gifts, unlike wallet/service.ts's
// listGiftTypes (the viewer-facing catalog) — finance needs to see and
// re-enable/reschedule a gift that isn't currently showing to viewers.
export async function listGiftTypesForAdmin(): Promise<AdminGiftType[]> {
  const { rows } = await pool.query<GiftTypeRow>(`${SELECT_GIFT_TYPE} ORDER BY gt.price_santim ASC`);
  return rows.map(mapRow);
}

export async function updateGiftType(
  adminId: string,
  giftTypeId: string,
  input: UpdateGiftTypeInput
): Promise<AdminGiftType> {
  const { rows: beforeRows } = await pool.query<GiftTypeRow>(`${SELECT_GIFT_TYPE} WHERE gt.id = $1`, [giftTypeId]);
  const before = beforeRows[0];
  if (!before) throw new AppError(404, "Gift type not found");

  await pool.query(
    `UPDATE gift_types SET
       price_santim      = COALESCE($1, price_santim),
       is_active         = COALESCE($2, is_active),
       category          = COALESCE($3, category),
       creator_share_bps = COALESCE($4, creator_share_bps),
       available_from    = CASE WHEN $5 THEN $6 ELSE available_from END,
       available_until   = CASE WHEN $7 THEN $8 ELSE available_until END,
       regions           = CASE WHEN $9 THEN $10 ELSE regions END
     WHERE id = $11`,
    [
      input.priceSantim ?? null,
      input.isActive ?? null,
      input.category ?? null,
      input.creatorShareBps ?? null,
      input.availableFrom !== undefined,
      input.availableFrom ?? null,
      input.availableUntil !== undefined,
      input.availableUntil ?? null,
      input.regions !== undefined,
      input.regions ?? null,
      giftTypeId,
    ]
  );

  const { rows: afterRows } = await pool.query<GiftTypeRow>(`${SELECT_GIFT_TYPE} WHERE gt.id = $1`, [giftTypeId]);
  const after = afterRows[0]!;

  await logAdminAction(adminId, "gift_type.update", "gift_type", giftTypeId, {
    reason: input.reason,
    before: mapRow(before),
    after: mapRow(after),
  });

  return mapRow(after);
}
