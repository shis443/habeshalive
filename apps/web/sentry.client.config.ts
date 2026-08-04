import * as Sentry from "@sentry/nextjs";

// Same stub-vs-real pattern as the rest of this codebase's optional
// integrations (Chapa, Resend, apps/api's own common/sentry.ts) — no real
// Sentry project exists yet, so this no-ops until NEXT_PUBLIC_SENTRY_DSN
// is set. DSNs are meant to be embedded in client bundles (Sentry's own
// design — not a secret the way an API key is), hence NEXT_PUBLIC_.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    // Vercel's VERCEL_GIT_COMMIT_SHA is a build-time-only env var — Next.js
    // only inlines vars actually prefixed NEXT_PUBLIC_ into the client
    // bundle, so next.config.mjs's `env` block re-exposes it under this
    // name (see that file's comment) rather than referencing the
    // unprefixed var directly here, which would silently be `undefined`
    // in the browser.
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || "dev",
    tracesSampleRate: 0,
  });
}
