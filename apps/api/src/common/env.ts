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
  // Social auth (E.3): empty in dev on purpose, same switch pattern as
  // Chapa above — auth/social-service.ts checks these before attempting
  // ID-token verification and returns a clear "not configured" error
  // rather than failing deep inside a JWKS lookup. No real Google Cloud /
  // Apple Developer app has been registered yet — this is genuinely
  // credential-blocked, not a code gap.
  GOOGLE_CLIENT_ID: z.string().default(""),
  APPLE_CLIENT_ID: z.string().default(""),
  API_PUBLIC_URL: z.string().min(1).default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().min(1).default("http://localhost:3000"),
  // Email (Resend): same empty-by-default switch pattern as Chapa above —
  // see auth/email-gateway.ts. A real key looks like "re_...".
  // RESEND_FROM_EMAIL defaults to Resend's own sandbox sender, which
  // works with zero domain setup — good enough until a real domain is
  // verified in the Resend dashboard.
  RESEND_API_KEY: z.string().default(""),
  RESEND_FROM_EMAIL: z.string().min(1).default("Birq <onboarding@resend.dev>"),
  // Real-time chat (Centrifugo). CENTRIFUGO_URL is this server's path to
  // Centrifugo's HTTP API (server-to-server publish) — differs from
  // NEXT_PUBLIC_CENTRIFUGO_URL (apps/web), which is the browser's path to
  // Centrifugo's WebSocket endpoint; the two are the same host in
  // production but never conflate them, since a container-internal
  // hostname (local dev) isn't reachable from a browser. Token secret must
  // match Centrifugo's own CENTRIFUGO_TOKEN_HMAC_SECRET_KEY exactly, or
  // every client connection gets rejected.
  CENTRIFUGO_URL: z.string().min(1).default("http://localhost:8000"),
  CENTRIFUGO_API_KEY: z.string().min(1).default("dev-only-change-me"),
  CENTRIFUGO_TOKEN_HMAC_SECRET: z.string().min(1).default("dev-only-change-me"),
  // VOD storage (Cloudflare R2, S3-compatible) — same account/pattern as
  // infra/backup's BACKUP_S3_* (see .env.example), just a different
  // bucket/prefix. Empty by default on purpose: no real bucket exists yet,
  // and common/object-storage.ts falls back to a stub that no-ops rather
  // than throwing, same switch pattern wallet/chapa-client.ts uses for
  // CHAPA_SECRET_KEY.
  VOD_S3_ENDPOINT: z.string().default(""),
  VOD_S3_ACCESS_KEY_ID: z.string().default(""),
  VOD_S3_SECRET_ACCESS_KEY: z.string().default(""),
  VOD_S3_BUCKET: z.string().default("habeshalive-vods"),
  // Image moderation (AWS Rekognition's DetectModerationLabels) — same
  // empty-by-default stub switch as everywhere else in this file. Chosen
  // over Google Cloud Vision SafeSearch/Hive because it's the option this
  // codebase already has SDK-family precedent for (@aws-sdk/client-s3 is
  // already a dependency for VOD storage above); functionally any of the
  // three would work. Flags likely nudity/violence/graphic content for
  // human review — it is explicitly NOT a CSAM detector (no general
  // moderation API is; that requires hash-matching against a known-CSAM
  // database via a program like NCMEC/PhotoDNA or Thorn Safer, a separate
  // vendor relationship this can't set up in code). See moderation/
  // image-moderation-client.ts's file comment for the full reasoning.
  AWS_REKOGNITION_ACCESS_KEY_ID: z.string().default(""),
  AWS_REKOGNITION_SECRET_ACCESS_KEY: z.string().default(""),
  AWS_REKOGNITION_REGION: z.string().default("us-east-1"),
  // Error tracking (Sentry) — same empty-by-default stub switch as
  // everywhere else in this file; common/sentry.ts no-ops when unset. No
  // real Sentry project exists yet (see docs/ROADMAP.md's top blocking
  // gap: "no error tracking or alerting in production").
  SENTRY_DSN: z.string().default(""),
  // Durable execution (Temporal) for payout disbursement — see
  // docs/temporal-migration-plan.md. Empty by default, same stub switch as
  // everywhere else in this file: wallet/service.ts's isTemporalConfigured
  // falls back to the original inline requestPayout/approvePayout logic
  // when unset, so this is safe to merge and deploy with zero behavior
  // change until a real Temporal server (self-hosted or Temporal Cloud —
  // still an open vendor decision, see that doc) actually exists.
  // TEMPORAL_ADDRESS looks like "namespace.acctid.tmprl.cloud:7233" for
  // Temporal Cloud, or "localhost:7233" self-hosted.
  TEMPORAL_ADDRESS: z.string().default(""),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  // Temporal Cloud requires mTLS, not just an address — empty/unused for a
  // self-hosted server with no auth configured (local dev).
  TEMPORAL_TLS_CLIENT_CERT: z.string().default(""),
  TEMPORAL_TLS_CLIENT_KEY: z.string().default(""),
  TEMPORAL_TASK_QUEUE: z.string().default("payouts"),
  // Fly.io sets FLY_IMAGE_REF automatically at runtime (the deployed
  // image's digest/tag) — used as the Sentry release identifier with zero
  // extra CI wiring needed. Empty locally (not running on Fly), which
  // common/sentry.ts treats as "dev".
  SENTRY_ENVIRONMENT: z.string().default("development"),
});

export const env = envSchema.parse(process.env);
