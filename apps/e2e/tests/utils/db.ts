import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://habeshalive:habeshalive@localhost:5432/habeshalive";

// Direct DB access from tests is deliberate here, not a shortcut around
// the API: promoting a user to admin has no (and shouldn't have one
// exposed over HTTP) self-service API — it's a manual/ops action in real
// life too, so a test needing an admin account does the same thing an
// operator would: touch the database directly.
export async function promoteToAdmin(userId: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
  } finally {
    await client.end();
  }
}
