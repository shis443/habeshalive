import { buildApp } from "./app.js";
import { env } from "./common/env.js";
import { reapStaleStreams } from "./streams/service.js";
import { renewSubscriptions } from "./subscriptions/service.js";

const app = buildApp();

const REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// "Daily" in spirit, not literally once per 24h from an arbitrary process
// boot time (which would drift/stall across redeploys) — renewSubscriptions
// is idempotent (only picks up rows whose expires_at has actually passed),
// so checking every few hours costs nothing and means a redeploy never
// delays a renewal by up to a full day.
const SUBSCRIPTION_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Wrapped so a rejection inside reapStaleStreams (e.g. a DB blip) never
// becomes an unhandled rejection that could crash the process — this runs
// unattended on a timer, with nothing else to catch it.
function runReaper(): void {
  reapStaleStreams().catch((err) => {
    app.log.error(err, "reapStaleStreams failed");
  });
}

function runSubscriptionRenewal(): void {
  renewSubscriptions().catch((err) => {
    app.log.error(err, "renewSubscriptions failed");
  });
}

app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    runReaper();
    setInterval(runReaper, REAP_INTERVAL_MS);
    runSubscriptionRenewal();
    setInterval(runSubscriptionRenewal, SUBSCRIPTION_RENEWAL_INTERVAL_MS);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
