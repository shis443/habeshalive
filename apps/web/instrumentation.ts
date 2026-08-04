import * as Sentry from "@sentry/nextjs";

// Next.js's instrumentation hook — auto-detected at the app root with no
// experimental flag needed as of this app's Next.js version (16.x;
// instrumentationHook stabilized in 15). sentry.client.config.ts is
// auto-loaded separately by Next.js/the Sentry webpack plugin for the
// browser bundle; this only covers the two runtimes that actually execute
// this file.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Sentry.captureRequestError is a safe no-op when Sentry.init was never
// called (same "stub means genuinely does nothing" contract every other
// optional integration in this codebase relies on) — no separate
// DSN-configured check needed here.
export const onRequestError = Sentry.captureRequestError;
