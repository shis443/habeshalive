import * as Sentry from "@sentry/node";
import { env } from "./env.js";
import { AppError } from "./errors.js";

// Stub-vs-real switch, same pattern as every other optional integration in
// this codebase (Chapa, Resend, Rekognition) — Sentry.init is a no-op
// SDK-internally when never called, so "not configured" here just means
// captureException below does nothing rather than throwing.
export const isSentryConfigured = Boolean(env.SENTRY_DSN);

export function initSentry(): void {
  if (!isSentryConfigured) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    // Fly sets this automatically at runtime (the deployed image's
    // digest/tag) — gives every captured event real release/version
    // context with no extra CI step to wire up. Falls back to "dev" when
    // running outside Fly (local dev, tests).
    release: process.env.FLY_IMAGE_REF ?? "dev",
    tracesSampleRate: 0,
  });
}

// Only unexpected failures — a routine AppError under 500 (401 unauthorized,
// 400 validation, 403 forbidden, ...) is expected control flow, not an
// incident, and reporting every one of those would drown real crashes in
// noise for whatever daily-triage process reads this project. ZodError is
// handled separately in app.ts's error handler before this is ever called
// (validation errors are even less interesting than an AppError).
export function captureUnexpectedError(err: unknown): void {
  if (!isSentryConfigured) return;
  if (err instanceof AppError && err.statusCode < 500) return;
  Sentry.captureException(err);
}
