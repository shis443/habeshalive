import { randomUUID } from "node:crypto";
import { EMOTE_CODE_PATTERN } from "@birq/shared";
import type { CatalogEmote, Emote, EmoteAdminItem, EmoteStatus } from "@birq/shared";
import { getBirqPlusEmoteSlotCount } from "../admin/config-service.js";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { deleteObject, getObjectBuffer, isObjectStorageConfigured, uploadObject } from "../common/object-storage.js";
import { notify } from "../notifications/service.js";
import { hasActivePlatformSubscription } from "../subscriptions/platform-service.js";

const ALLOWED_EMOTE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
// A real emote is a small icon (Twitch itself caps custom emotes at
// 1MB for the largest of its 3 sizes) — generous enough for GIF/PNG art,
// small enough that a chat client inlining dozens of these per message
// history stays cheap.
const MAX_EMOTE_BYTES = 512 * 1024;

interface EmoteRow {
  id: string;
  code: string;
  image_key: string;
  status: EmoteStatus;
  rejection_reason: string | null;
  created_at: string;
}

function emoteImageUrl(id: string): string {
  // Proxied through this API, not a signed object-storage URL — same
  // "stable, public, long-cached" posture as clip-service.ts's OG-image
  // route: an emote's art never changes after upload, and it's rendered
  // inline in every chat viewer's client repeatedly, unlike a VOD's
  // short-lived signed playback URL.
  return `/emotes/${id}/image`;
}

function toEmote(row: EmoteRow): Emote {
  return {
    id: row.id,
    code: row.code,
    imageUrl: emoteImageUrl(row.id),
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

// Build 3 — Birq Plus's "global emote slot" perk. Gated on an active
// platform subscription (subscriptions/platform-service.ts) at upload
// time, not just at render time — same "check the perk where it's
// granted" posture as the extended VOD retention perk in
// vods/service.ts's createVodFromRecording.
export async function createEmote(
  userId: string,
  code: string,
  buffer: Buffer,
  contentType: string
): Promise<Emote> {
  if (!isObjectStorageConfigured) {
    throw new AppError(503, "Emote upload isn't available right now — try again later.");
  }
  if (!(await hasActivePlatformSubscription(userId))) {
    throw new AppError(403, "Uploading custom emotes is a Birq Plus perk.");
  }
  if (!EMOTE_CODE_PATTERN.test(code)) {
    throw new AppError(400, "Emote codes must be 2-32 letters, digits, or underscores.");
  }
  if (!ALLOWED_EMOTE_CONTENT_TYPES.has(contentType)) {
    throw new AppError(400, "Upload a PNG, JPEG, or GIF image.");
  }
  if (buffer.byteLength === 0) throw new AppError(400, "The uploaded file is empty.");
  if (buffer.byteLength > MAX_EMOTE_BYTES) throw new AppError(400, "File is too large (max 512KB).");

  const slotCount = await getBirqPlusEmoteSlotCount();
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM emotes WHERE created_by = $1 AND status != 'rejected'`,
    [userId]
  );
  if (Number(countRows[0]!.count) >= slotCount) {
    throw new AppError(400, `You've used all ${slotCount} of your emote slots.`);
  }

  const { rows: existing } = await pool.query(`SELECT 1 FROM emotes WHERE code = $1`, [code]);
  if (existing[0]) throw new AppError(409, "That emote code is already taken.");

  const imageKey = `emotes/${userId}/${randomUUID()}`;
  await uploadObject(imageKey, buffer, contentType);

  const { rows } = await pool.query<EmoteRow>(
    `INSERT INTO emotes (code, image_key, created_by) VALUES ($1, $2, $3)
     RETURNING id, code, image_key, status, rejection_reason, created_at`,
    [code, imageKey, userId]
  );
  return toEmote(rows[0]!);
}

export async function listMyEmotes(userId: string): Promise<Emote[]> {
  const { rows } = await pool.query<EmoteRow>(
    `SELECT id, code, image_key, status, rejection_reason, created_at
     FROM emotes WHERE created_by = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(toEmote);
}

// Public — every chat client (web + mobile) fetches this once to build
// its :code: -> imageUrl lookup for rendering, and refetches occasionally
// to pick up newly-approved emotes. No pagination: this platform's whole
// approved catalog is expected to stay small (bounded by
// birq_plus_emote_slot_count x however many Birq Plus subscribers have
// actually uploaded), not an open-ended feed.
export async function getApprovedEmoteCatalog(): Promise<CatalogEmote[]> {
  const { rows } = await pool.query<EmoteRow>(
    `SELECT id, code, image_key, status, rejection_reason, created_at
     FROM emotes WHERE status = 'approved' ORDER BY code ASC`
  );
  return rows.map((row) => ({ id: row.id, code: row.code, imageUrl: emoteImageUrl(row.id) }));
}

export async function getEmoteImage(emoteId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const { rows } = await pool.query<{ image_key: string }>(`SELECT image_key FROM emotes WHERE id = $1`, [emoteId]);
  const key = rows[0]?.image_key;
  if (!key) throw new AppError(404, "Emote not found");
  const { buffer, contentType } = await getObjectBuffer(key);
  return { buffer, contentType: contentType ?? "image/png" };
}

export async function deleteEmoteOwned(emoteId: string, userId: string): Promise<void> {
  const { rows } = await pool.query<{ image_key: string }>(
    `DELETE FROM emotes WHERE id = $1 AND created_by = $2 RETURNING image_key`,
    [emoteId, userId]
  );
  if (!rows[0]) throw new AppError(404, "Emote not found");
  await deleteObject(rows[0].image_key);
}

// --- Admin review queue (mirrors kyc/service.ts's listKycSubmissions/
// approveKyc/rejectKyc shape exactly) ---

interface EmoteAdminRow extends EmoteRow {
  created_by_username: string;
}

export async function listEmotesForAdmin(status?: EmoteStatus): Promise<EmoteAdminItem[]> {
  const { rows } = await pool.query<EmoteAdminRow>(
    `SELECT e.id, e.code, e.image_key, e.status, e.rejection_reason, e.created_at, u.username AS created_by_username
     FROM emotes e JOIN users u ON u.id = e.created_by
     ${status ? "WHERE e.status = $1" : ""}
     ORDER BY e.created_at ASC`,
    status ? [status] : []
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    imageUrl: emoteImageUrl(row.id),
    createdByUsername: row.created_by_username,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }));
}

export async function approveEmote(adminId: string, emoteId: string): Promise<void> {
  const { rows } = await pool.query<{ created_by: string; code: string }>(
    `UPDATE emotes SET status = 'approved', reviewed_by = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending'
     RETURNING created_by, code`,
    [adminId, emoteId]
  );
  if (!rows[0]) throw new AppError(404, "Emote not found or already reviewed");
  await logAdminAction(adminId, "emote.approve", "emote", emoteId);
  await notify(rows[0].created_by, "emote_approved", `Your emote :${rows[0].code}: was approved`, {
    body: "It's live in chat for everyone now.",
    linkUrl: "/settings",
  });
}

export async function rejectEmote(adminId: string, emoteId: string, reason: string): Promise<void> {
  const { rows } = await pool.query<{ created_by: string; code: string }>(
    `UPDATE emotes SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING created_by, code`,
    [reason, adminId, emoteId]
  );
  if (!rows[0]) throw new AppError(404, "Emote not found or already reviewed");
  await logAdminAction(adminId, "emote.reject", "emote", emoteId, {
    reason,
    before: { status: "pending" },
    after: { status: "rejected", rejectionReason: reason },
  });
  await notify(rows[0].created_by, "emote_rejected", `Your emote :${rows[0].code}: needs another look`, {
    body: reason,
    linkUrl: "/settings",
  });
}
