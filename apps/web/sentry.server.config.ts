import * as Sentry from "@sentry/nextjs";

// Server-side (Node.js runtime) init — imported from instrumentation.ts's
// register() hook, not auto-loaded by Next.js the way sentry.client.config
// is. Uses the same NEXT_PUBLIC_SENTRY_DSN as the client config: a DSN
// isn't a secret (see that file's comment), and reusing one var instead of
// a separate server-only one keeps this in sync with zero extra config.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    // No NEXT_PUBLIC_ prefix needed here — this file only ever runs
    // server-side, so the raw Vercel-provided build var is fine directly.
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    tracesSampleRate: 0,
  });
}
