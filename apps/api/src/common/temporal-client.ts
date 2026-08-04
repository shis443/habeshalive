import { Client, Connection } from "@temporalio/client";
import { env } from "./env.js";

// Same stub-vs-real switch as every other optional integration in this
// codebase — callers check this before routing through a workflow,
// falling back to the original inline implementation otherwise. Shared
// across every Temporal-backed feature (payouts, gift-card delivery, ...)
// rather than one connection per domain: at this app's current scale, one
// worker process polling one task queue is the right amount of
// operational surface, not a separate deployable per workflow type.
export const isTemporalConfigured = Boolean(env.TEMPORAL_ADDRESS);

let clientPromise: Promise<Client> | null = null;

export async function getTemporalClient(): Promise<Client> {
  clientPromise ??= (async () => {
    const connection = await Connection.connect({
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
    return new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
  })();
  return clientPromise;
}
