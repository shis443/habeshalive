import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { env } from "../../common/env.js";
import { captureUnexpectedError, initSentry } from "../../common/sentry.js";
import * as activities from "./activities.js";

// Separate deployable process from apps/api's Fastify server (server.ts) —
// deliberately, per docs/temporal-migration-plan.md's Infra requirements
// section: a worker crash shouldn't take down request handling and vice
// versa. Run this via a new Fly [processes] entry or its own small Fly
// app, started with `npm run worker -w apps/api` (see package.json).
//
// Not started automatically by server.ts — this only does anything once
// TEMPORAL_ADDRESS is actually configured, and even then it's a distinct
// process a human deploys deliberately, not a side effect of the API
// booting.
async function main(): Promise<void> {
  if (!env.TEMPORAL_ADDRESS) {
    console.error("[temporal-worker] TEMPORAL_ADDRESS is not set — refusing to start with nothing to connect to.");
    process.exit(1);
  }

  initSentry();

  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
    tls:
      env.TEMPORAL_TLS_CLIENT_CERT && env.TEMPORAL_TLS_CLIENT_KEY
        ? {
            clientCertPair: {
              crt: Buffer.from(env.TEMPORAL_TLS_CLIENT_CERT),
              key: Buffer.from(env.TEMPORAL_TLS_CLIENT_KEY),
            },
          }
        : undefined,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflow.js", import.meta.url)),
    activities,
  });

  console.log(`[temporal-worker] polling task queue "${env.TEMPORAL_TASK_QUEUE}" on ${env.TEMPORAL_ADDRESS}`);
  await worker.run();
}

main().catch((err) => {
  console.error("[temporal-worker] fatal error:", err);
  captureUnexpectedError(err);
  process.exit(1);
});
