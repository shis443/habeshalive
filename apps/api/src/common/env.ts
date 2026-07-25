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
  // "http" for local dev (SRS's http_server has no TLS of its own — see
  // infra/srs/fly.toml's comment on this). Production sets this to
  // "https" since Fly's http_service terminates real TLS in front of it,
  // and a browser on an HTTPS page (apps/web on Vercel) would block a
  // plain http:// HLS fetch as mixed content otherwise.
  SRS_HTTP_SCHEME: z.enum(["http", "https"]).default("http"),
  // Chapa (payments): empty in dev on purpose — that's the switch
  // wallet/chapa-client.ts uses to fall back to the stub implementation.
  // A real key looks like "CHASECK-..." (test) or "CHASECK_LIVE-...";
  // there's no real Chapa sandbox account behind this yet.
  CHAPA_SECRET_KEY: z.string().default(""),
  CHAPA_WEBHOOK_SECRET: z.string().default(""),
  API_PUBLIC_URL: z.string().min(1).default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().min(1).default("http://localhost:3000"),
  // Email (Resend): same empty-by-default switch pattern as Chapa above —
  // see auth/email-gateway.ts. A real key looks like "re_...".
  // RESEND_FROM_EMAIL defaults to Resend's own sandbox sender, which
  // works with zero domain setup — good enough until a real domain is
  // verified in the Resend dashboard.
  RESEND_API_KEY: z.string().default(""),
  RESEND_FROM_EMAIL: z.string().min(1).default("HabeshaLive <onboarding@resend.dev>"),
});

export const env = envSchema.parse(process.env);
