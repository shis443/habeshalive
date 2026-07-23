import { Redis } from "ioredis";
import { env } from "./env.js";

// connectTimeout/maxRetriesPerRequest overrides per @fastify/rate-limit's
// own README: its default ioredis settings aren't tuned for rate-limiting
// (unbounded retries would rather hang a request than fail it fast).
export const redis = new Redis(env.REDIS_URL, {
  connectTimeout: 500,
  maxRetriesPerRequest: 1,
});
