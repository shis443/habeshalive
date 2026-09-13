import { buildApp } from "./app.js";
import { settleAdRevenue } from "./ads/service.js";
import { rebuildOpenLeaderboardWindows } from "./admin/leaderboard-service.js";
import { recomputeTrailingRevenueDays } from "./admin/revenue-daily-service.js";
import { processAccountDeletions } from "./auth/account-deletion-service.js";
import { purgeOldChatMessages } from "./chat/service.js";
import { env } from "./common/env.js";
import { captureUnexpectedError, initSentry } from "./common/sentry.js";
import { sendScheduledGiftCards } from "./gift-cards/service.js";
import { promoteStartingStreams, reapStaleStreams } from "./streams/service.js";
import { reconcileStreamControls } from "./streams/emergency-controls-service.js";
import { rollupStaleViewerSamples, sampleLiveViewerCounts } from "./streams/viewer-samples-service.js";
import { renewPlatformSubscriptions } from "./subscriptions/platform-service.js";
import { renewSubscriptions } from "./subscriptions/service.js";
import { cleanupExpiredVods } from "./vods/service.js";
import { clearDueEarningHolds } from "./wallet/earning-holds-service.js";

// Before buildApp() — Sentry needs to be initialized before anything it
// might need to capture can run, same reasoning as every Sentry SDK's own
// setup docs (a request that fails during app construction should still be
// reportable).
initSentry();

const app = buildApp();

const REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Much shorter than REAP_INTERVAL_MS on purpose — this directly gates how
// long a viewer's player sits in "waiting" after a creator goes live (see
// streams/service.ts's promoteStartingStreams()), unlike the reaper, which
// only cleans up already-dead 'live' rows on its own schedule. Each run is
// cheap: realistically a handful of concurrent 'starting' rows at most,
// one manifest GET each.
const PROMOTE_STARTING_INTERVAL_MS = 3 * 1000; // 3 seconds
// A force-end kill that failed to confirm is exactly the situation T0
// exists to make visible rather than silent — retried well inside a
// human's likely attention span on a still-broadcasting stream, but not
// so tight that a genuinely offline SRS gets hammered.
const RECONCILE_STREAM_CONTROLS_INTERVAL_MS = 15 * 1000; // 15 seconds
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
// Same "daily in spirit" reasoning as subscription renewal/VOD cleanup —
// a few hours' delay on either of these costs nothing real.
const CHAT_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// account-deletion-service.ts's processAccountDeletions existed but was
// never actually invoked anywhere in this file — found while wiring up
// the new chat-retention job below. A user who completed the 30-day
// grace period never actually got anonymized without this; fixed as part
// of the same pass since it's the same "PII retention" concern.
const ACCOUNT_DELETION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// T2's clearing job — checked far more often than the 14-day window it's
// enforcing needs, because the standing rule for this exact job is "an
// enforcement control's acceptance test must observe the external system,
// not a model of it": a creator whose hold clears at 03:14:07 should see it
// reflected within minutes, not sit for up to 6 hours behind a job that
// only runs "daily in spirit." Cheap to run this often — most ticks touch
// zero rows.
const EARNING_HOLDS_CLEARING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
// T4's fixed cadence, verbatim from the task: "sample every live room at
// a fixed 60s cadence." The viewer-seconds math (SUM(viewer_count) * 60)
// only holds if this actually runs every 60s, not roughly-every-60s.
const VIEWER_SAMPLE_INTERVAL_MS = 60 * 1000; // 60 seconds
// "Daily in spirit" — the 90-day retention window has no reason to be
// checked more than a few times a day; most ticks touch zero rows since
// a stream's samples only cross the 90-day line once.
const VIEWER_SAMPLE_ROLLUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// T5's tightest stated cadence ("daily rebuilds every 5 min") — see
// leaderboard-service.ts's rebuildOpenLeaderboardWindows for why one job
// on this single interval also satisfies the looser weekly/monthly
// (hourly) and alltime (nightly) requirements at Birq's current scale.
const LEADERBOARD_REBUILD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// T6's revenue_daily — "recompute the trailing 35 days nightly." Same
// "daily in spirit" reasoning as every other nightly-cadence job in this
// file: checked every 6 hours so a redeploy around midnight never delays
// the whole trailing window by up to a full day.
const REVENUE_DAILY_RECOMPUTE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Wrapped so a rejection inside reapStaleStreams (e.g. a DB blip) never
// becomes an unhandled rejection that could crash the process — this runs
// unattended on a timer, with nothing else to catch it.
function runReaper(): void {
  reapStaleStreams().catch((err) => {
    app.log.error(err, "reapStaleStreams failed");
    captureUnexpectedError(err);
  });
}

// Wrapped the same way as runReaper() above, same reasoning — this also
// runs unattended on a timer.
function runPromoteStarting(): void {
  promoteStartingStreams().catch((err) => {
    app.log.error(err, "promoteStartingStreams failed");
    captureUnexpectedError(err);
  });
}

// Wrapped the same way as runReaper() above, same reasoning — this also
// runs unattended on a timer.
function runReconcileStreamControls(): void {
  reconcileStreamControls().catch((err) => {
    app.log.error(err, "reconcileStreamControls failed");
    captureUnexpectedError(err);
  });
}

function runSubscriptionRenewal(): void {
  renewSubscriptions().catch((err) => {
    app.log.error(err, "renewSubscriptions failed");
    captureUnexpectedError(err);
  });
}

function runPlatformSubscriptionRenewal(): void {
  renewPlatformSubscriptions().catch((err) => {
    app.log.error(err, "renewPlatformSubscriptions failed");
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

function runChatRetention(): void {
  purgeOldChatMessages().catch((err) => {
    app.log.error(err, "purgeOldChatMessages failed");
    captureUnexpectedError(err);
  });
}

function runAccountDeletions(): void {
  processAccountDeletions().catch((err) => {
    app.log.error(err, "processAccountDeletions failed");
    captureUnexpectedError(err);
  });
}

function runEarningHoldsClearing(): void {
  clearDueEarningHolds().catch((err) => {
    app.log.error(err, "clearDueEarningHolds failed");
    captureUnexpectedError(err);
  });
}

function runViewerSampling(): void {
  sampleLiveViewerCounts().catch((err) => {
    app.log.error(err, "sampleLiveViewerCounts failed");
    captureUnexpectedError(err);
  });
}

function runViewerSampleRollup(): void {
  rollupStaleViewerSamples().catch((err) => {
    app.log.error(err, "rollupStaleViewerSamples failed");
    captureUnexpectedError(err);
  });
}

function runLeaderboardRebuild(): void {
  rebuildOpenLeaderboardWindows().catch((err) => {
    app.log.error(err, "rebuildOpenLeaderboardWindows failed");
    captureUnexpectedError(err);
  });
}

function runRevenueDailyRecompute(): void {
  recomputeTrailingRevenueDays().catch((err) => {
    app.log.error(err, "recomputeTrailingRevenueDays failed");
    captureUnexpectedError(err);
  });
}

app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    runReaper();
    setInterval(runReaper, REAP_INTERVAL_MS);
    runPromoteStarting();
    setInterval(runPromoteStarting, PROMOTE_STARTING_INTERVAL_MS);
    runReconcileStreamControls();
    setInterval(runReconcileStreamControls, RECONCILE_STREAM_CONTROLS_INTERVAL_MS);
    runSubscriptionRenewal();
    setInterval(runSubscriptionRenewal, SUBSCRIPTION_RENEWAL_INTERVAL_MS);
    runPlatformSubscriptionRenewal();
    setInterval(runPlatformSubscriptionRenewal, SUBSCRIPTION_RENEWAL_INTERVAL_MS);
    runVodCleanup();
    setInterval(runVodCleanup, VOD_CLEANUP_INTERVAL_MS);
    runAdSettlement();
    setInterval(runAdSettlement, AD_SETTLEMENT_INTERVAL_MS);
    runGiftCardDelivery();
    setInterval(runGiftCardDelivery, GIFT_CARD_DELIVERY_INTERVAL_MS);
    runChatRetention();
    setInterval(runChatRetention, CHAT_RETENTION_INTERVAL_MS);
    runAccountDeletions();
    setInterval(runAccountDeletions, ACCOUNT_DELETION_INTERVAL_MS);
    runEarningHoldsClearing();
    setInterval(runEarningHoldsClearing, EARNING_HOLDS_CLEARING_INTERVAL_MS);
    runViewerSampling();
    setInterval(runViewerSampling, VIEWER_SAMPLE_INTERVAL_MS);
    runViewerSampleRollup();
    setInterval(runViewerSampleRollup, VIEWER_SAMPLE_ROLLUP_INTERVAL_MS);
    runLeaderboardRebuild();
    setInterval(runLeaderboardRebuild, LEADERBOARD_REBUILD_INTERVAL_MS);
    runRevenueDailyRecompute();
    setInterval(runRevenueDailyRecompute, REVENUE_DAILY_RECOMPUTE_INTERVAL_MS);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
