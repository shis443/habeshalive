import { buildApp } from "./app.js";
import { settleAdRevenue } from "./ads/service.js";
import { env } from "./common/env.js";
import { captureUnexpectedError, initSentry } from "./common/sentry.js";
import { sendScheduledGiftCards } from "./gift-cards/service.js";
import { reapStaleStreams } from "./streams/service.js";
import { renewSubscriptions } from "./subscriptions/service.js";
import { cleanupExpiredVods } from "./vods/service.js";

// Before buildApp() — Sentry needs to be initialized before anything it
// might need to capture can run, same reasoning as every Sentry SDK's own
// setup docs (a request that fails during app construction should still be
// reportable).
initSentry();

const app = buildApp();

const REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// "Daily" in spirit, not literally once per 24h from an arbitrary process
// boot time (which would drift/stall across redeploys) — renewSubscriptions
// is idempotent (only picks up rows whose expires_at has actually passed),
// so checking every few hours costs nothing and means a redeploy never
// delays a renewal by up to a full day.
const SUBSCRIPTION_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Same "daily in spirit" reasoning as subscription renewal above — expired
// VODs sitting an extra few hours costs nothing.
const VOD_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Ad revenue settlement (see ads/service.ts's settleAdRevenue — batches
// impressions into one ledger transaction per creator instead of writing
// on every single impression). More frequent than the other jobs since
// this is real creator earnings a payout request could be waiting on.
const AD_SETTLEMENT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
// Scheduled gift card deliveries (birthdays, holidays) — checked often
// enough that "deliver on this date" reads as roughly accurate to a
// purchaser without needing exact-minute precision.
const GIFT_CARD_DELIVERY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Wrapped so a rejection inside reapStaleStreams (e.g. a DB blip) never
// becomes an unhandled rejection that could crash the process — this runs
// unattended on a timer, with nothing else to catch it.
function runReaper(): void {
  reapStaleStreams().catch((err) => {
    app.log.error(err, "reapStaleStreams failed");
    captureUnexpectedError(err);
  });
}

function runSubscriptionRenewal(): void {
  renewSubscriptions().catch((err) => {
    app.log.error(err, "renewSubscriptions failed");
    captureUnexpectedError(err);
  });
}

function runVodCleanup(): void {
  cleanupExpiredVods().catch((err) => {
    app.log.error(err, "cleanupExpiredVods failed");
    captureUnexpectedError(err);
  });
}

function runAdSettlement(): void {
  settleAdRevenue().catch((err) => {
    app.log.error(err, "settleAdRevenue failed");
    captureUnexpectedError(err);
  });
}

function runGiftCardDelivery(): void {
  sendScheduledGiftCards().catch((err) => {
    app.log.error(err, "sendScheduledGiftCards failed");
    captureUnexpectedError(err);
  });
}

app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    runReaper();
    setInterval(runReaper, REAP_INTERVAL_MS);
    runSubscriptionRenewal();
    setInterval(runSubscriptionRenewal, SUBSCRIPTION_RENEWAL_INTERVAL_MS);
    runVodCleanup();
    setInterval(runVodCleanup, VOD_CLEANUP_INTERVAL_MS);
    runAdSettlement();
    setInterval(runAdSettlement, AD_SETTLEMENT_INTERVAL_MS);
    runGiftCardDelivery();
    setInterval(runGiftCardDelivery, GIFT_CARD_DELIVERY_INTERVAL_MS);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
