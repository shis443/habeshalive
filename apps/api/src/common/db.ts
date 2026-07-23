import pg from "pg";
import { env } from "./env.js";

// BIGINT columns (amount_santim, balance_santim) come back as strings by
// default to avoid silent precision loss on huge values. Santim amounts
// never approach Number.MAX_SAFE_INTEGER, so parse them as plain integers
// for JSON-safe, ergonomic arithmetic throughout the app.
pg.types.setTypeParser(20, (value) => parseInt(value, 10));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
