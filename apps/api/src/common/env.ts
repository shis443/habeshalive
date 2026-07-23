import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  VIDEO_WEBHOOK_SECRET: z.string().min(1),
  // Host creators' OBS points at (RTMP ingest) and the host clients fetch
  // HLS playback from (SRS's HTTP server) — different in local dev
  // (localhost) vs. production (the real domain/IP), hence env-driven.
  SRS_RTMP_HOST: z.string().min(1).default("localhost:1935"),
  SRS_HTTP_HOST: z.string().min(1).default("localhost:8080"),
  // Chapa (payments): empty in dev on purpose — that's the switch
  // wallet/chapa-client.ts uses to fall back to the stub implementation.
  // A real key looks like "CHASECK-..." (test) or "CHASECK_LIVE-...";
  // there's no real Chapa sandbox account behind this yet.
  CHAPA_SECRET_KEY: z.string().default(""),
  CHAPA_WEBHOOK_SECRET: z.string().default(""),
  API_PUBLIC_URL: z.string().min(1).default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().min(1).default("http://localhost:3000"),
});

export const env = envSchema.parse(process.env);
