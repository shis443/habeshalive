import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  VIDEO_WEBHOOK_SECRET: z.string().min(1),
  // AES-256 key for encrypting creator_profiles.stream_key at rest (see
  // common/crypto.ts) — base64, must decode to exactly 32 bytes. Unlike
  // Stripe/Telebirr-style third-party credentials, this is fully self-
  // generated infra (e.g. `openssl rand -base64 32`), not something
  // requiring a business account.
  STREAM_KEY_ENCRYPTION_KEY: z.string().min(1),
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
  // SRS's http_api (WHEP playback signaling + the admin client-kick
  // endpoint), reached server-to-server — deliberately NOT the public
  // SRS_HTTP_HOST/8443 WHIP URL above. In production this is Fly's private
  // 6PN hostname (http://habeshalive-srs.internal:1985), set via
  // `flyctl secrets set` on the habeshalive app (see docs/architecture.md).
  // SRS's admin API (/api/v1/*) has no auth of its own and shares its port
  // with WHIP publish signaling, so it's never exposed publicly (see
  // infra/srs/conf/whip-proxy.nginx.conf) — this base URL is how
  // whep-routes.ts and moderation/actions-service.ts's ban-teardown reach
  // it instead. Defaults to localhost:1985 for local dev, matching
  // SRS_HTTP_HOST's own default (docker-compose's haproxy publishes SRS's
  // http_api on the host's 1985 directly, same as every other SRS_*_HOST
  // default in this file).
  SRS_ADMIN_API_BASE: z.string().min(1).default("http://localhost:1985"),
  // Default-off kill switch for the WHEP (WebRTC playback) broker — see
  // streams/whep-routes.ts. Same empty-by-default stub switch as
  // everywhere else in this file: real end-to-end WebRTC/ICE/media
  // behavior can't be verified in this environment (no real browser or
  // network path to test against, unlike the Postgres-backed features
  // elsewhere in this codebase), so this ships disabled until someone can
  // actually watch a real stream over it before flipping it on in
  // production. The frontend has its own independent gate
  // (NEXT_PUBLIC_WHEP_ENABLED, see apps/web/lib/config.ts) — both must be
  // on for a viewer to ever attempt WHEP; this one alone still protects
  // the route even if a client POSTs to it directly.
  WHEP_ENABLED: z.string().default(""),
  // Global cap on concurrent WHEP playback sessions — each one is a real
  // WebRTC session on the single srs machine (CPU for SRTP encryption +
  // bandwidth per viewer, unlike HLS which is just static file serving
  // fanned out by SRS's http_server), so this is a backstop against
  // exhausting that one machine, not a per-user/per-stream limit.
  WHEP_MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(200),
  // HLS viewer-session token signing (docs/egress-protection-plan.md) —
  // empty by default, same stub switch as everywhere else in this file.
  // streams/hls-token.ts appends a signed token to playback URLs only
  // when this is set; harmless before that (SRS's static file server
  // ignores the extra query param), and does nothing until the
  // Cloudflare Worker that actually validates it is deployed.
  HLS_TOKEN_HMAC_SECRET: z.string().default(""),
  // Chapa (payments): empty in dev on purpose — that's the switch
  // wallet/chapa-client.ts uses to fall back to the stub implementation.
  // A real key looks like "CHASECK-..." (test) or "CHASECK_LIVE-...";
  // there's no real Chapa sandbox account behind this yet.
  CHAPA_SECRET_KEY: z.string().default(""),
  CHAPA_WEBHOOK_SECRET: z.string().default(""),
  // Module 2 diaspora bridge — international-card top-ups for donors
  // outside Ethiopia (Chapa's own hosted checkout already covers Telebirr/
  // CBE Birr/HelloCash/local cards natively, so those two don't get a
  // separate client — see wallet/diaspora-topup-service.ts's own comment).
  // Same empty-by-default stub-switch pattern as Chapa above; no real
  // Stripe/PayPal business account exists yet.
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_WEBHOOK_ID: z.string().default(""),
  // "api-m" host — PayPal's current REST API gateway, per their own
  // authentication docs (developer.paypal.com, verified 2026-08-07).
  // Overridable for sandbox testing (api-m.sandbox.paypal.com).
  PAYPAL_API_BASE: z.string().default("https://api-m.paypal.com"),
  // Module 4 — go-live announcements to a platform-wide Telegram channel.
  // Same empty-by-default stub-switch pattern as Chapa/Stripe/PayPal
  // above; no real bot has been registered with @BotFather yet.
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHANNEL_ID: z.string().default(""),
  // Fixed-at-request-time conversion (USD -> ETB santim) — this platform
  // has no live FX feed anywhere else, so a real deployment would need to
  // update this periodically (or add one) rather than trusting a stale
  // hardcoded default; 0 here doubles as "not configured," matching the
  // rest of this block.
  DIASPORA_USD_TO_ETB_RATE: z.coerce.number().nonnegative().default(0),
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
  // One task queue for every Temporal-backed workflow in this app
  // (payouts, gift-card delivery, ...) — see apps/api/src/temporal/
  // worker.ts's comment for why one consolidated worker process is the
  // right amount of operational surface at this app's current scale.
  TEMPORAL_TASK_QUEUE: z.string().default("birq-workflows"),
  // Fly.io sets FLY_IMAGE_REF automatically at runtime (the deployed
  // image's digest/tag) — used as the Sentry release identifier with zero
  // extra CI wiring needed. Empty locally (not running on Fly), which
  // common/sentry.ts treats as "dev".
  SENTRY_ENVIRONMENT: z.string().default("development"),
});

export const env = envSchema.parse(process.env);
