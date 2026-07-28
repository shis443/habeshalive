import type { UpdateUserRoleInput, UserListItem } from "@habeshalive/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  phone_number: string | null;
  email: string | null;
  role: UserListItem["role"];
  is_banned: boolean;
  created_at: string;
  wallet_balance_santim: string | null;
  gifts_sent_count: string;
  gifts_sent_santim: string | null;
}

function mapRow(row: UserRow): UserListItem {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    email: row.email,
    role: row.role,
    isBanned: row.is_banned,
    createdAt: row.created_at,
    walletBalanceSantim: Number(row.wallet_balance_santim ?? 0),
    giftsSentCount: Number(row.gifts_sent_count),
    giftsSentSantim: Number(row.gifts_sent_santim ?? 0),
  };
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.phone_number, u.email, u.role, u.is_banned, u.created_at,
         (SELECT wb.balance_santim FROM wallets w JOIN wallet_balances_cache wb ON wb.wallet_id = w.id
          WHERE w.owner_type = 'user' AND w.owner_id = u.id) AS wallet_balance_santim,
         (SELECT count(*) FROM gifts_sent WHERE sender_id = u.id) AS gifts_sent_count,
         (SELECT sum(gt.price_santim * gs.quantity) FROM gifts_sent gs JOIN gift_types gt ON gt.id = gs.gift_type_id
          WHERE gs.sender_id = u.id) AS gifts_sent_santim
  FROM users u
`;

export async function listUsers(search?: string): Promise<UserListItem[]> {
  const { rows } = await pool.query<UserRow>(
    `${USER_SELECT}
     WHERE ($1::text IS NULL OR u.username ILIKE '%' || $1 || '%' OR u.phone_number ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
     ORDER BY u.created_at DESC
     LIMIT 100`,
    [search ?? null]
  );
  return rows.map(mapRow);
}

// This is how the admin team itself grows over time — the doc's own
// reasoning for why this needs to exist somewhere. Kept deliberately
// simple (no separate "pending invite" flow): an existing account is
// promoted directly.
export async function updateUserRole(adminId: string, userId: string, input: UpdateUserRoleInput): Promise<UserListItem> {
  const { rowCount } = await pool.query(`UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, [
    input.role,
    userId,
  ]);
  if (!rowCount) throw new AppError(404, "User not found");
  await logAdminAction(adminId, "user.update_role", "user", userId, { metadata: { role: input.role } });

  const { rows } = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
  return mapRow(rows[0]!);
}
