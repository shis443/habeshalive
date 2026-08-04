import * as Sentry from "@sentry/nextjs";

// Edge runtime (middleware, edge routes) — this app doesn't currently use
// either, but Next.js's instrumentation.ts hook checks NEXT_RUNTIME
// unconditionally, so this file needs to exist and no-op safely the same
// way the other two configs do rather than the register() call throwing
// if an edge runtime is ever added later.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    tracesSampleRate: 0,
  });
}
