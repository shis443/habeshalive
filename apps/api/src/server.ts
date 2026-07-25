import { buildApp } from "./app.js";
import { env } from "./common/env.js";
import { reapStaleStreams } from "./streams/service.js";

const app = buildApp();

const REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Wrapped so a rejection inside reapStaleStreams (e.g. a DB blip) never
// becomes an unhandled rejection that could crash the process — this runs
// unattended on a timer, with nothing else to catch it.
function runReaper(): void {
  reapStaleStreams().catch((err) => {
    app.log.error(err, "reapStaleStreams failed");
  });
}

app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    runReaper();
    setInterval(runReaper, REAP_INTERVAL_MS);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
