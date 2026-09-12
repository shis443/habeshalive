import dns from "node:dns/promises";
import { env } from "./env.js";

// SRS_NODE_COUNT (common/env.ts) is a config value that has to track
// infrastructure state, and config values drift from infrastructure:
// scale from 2 SRS machines to 3, forget to bump the env var, and
// killPublisherConfirmed's fallback search path concludes "not
// broadcasting anywhere" after observing only 2 of the real 3 nodes —
// silent success, the exact class of bug this whole fix exists to remove,
// a third time.
//
// On Fly, `<app>.internal` resolves via the platform's own internal DNS to
// one AAAA record per currently-running machine in that app (6PN) — DNS is
// ground truth for "how many nodes exist right now" and costs nothing to
// ask, unlike a config value someone has to remember to update.
//
// NOT independently verified against a real Fly deployment from this
// environment — only the fallback path (no AAAA records, e.g. `localhost`
// or a single-A-record dev host) is exercised by anything in this repo's
// test suite or by direct observation here. `dns.resolve6("localhost")`
// was confirmed live to reject with ESERVFAIL, which is what routes this
// function to the SRS_NODE_COUNT fallback — that specific behavior is
// real and tested. The "N AAAA records for N Fly machines" half of this
// comment is the documented Fly convention, asserted, not observed from
// here; confirm it against a real multi-machine `.internal` deployment
// before removing SRS_NODE_COUNT as the fallback.
export async function resolveSrsNodeCount(): Promise<number> {
  let hostname: string;
  try {
    hostname = new URL(env.SRS_ADMIN_API_BASE).hostname;
  } catch {
    return env.SRS_NODE_COUNT;
  }

  try {
    const addresses = await dns.resolve6(hostname);
    if (addresses.length > 0) return addresses.length;
  } catch {
    // No AAAA records for this host — expected and normal for a
    // docker-compose hostname or "localhost" in dev, not an error
    // worth logging on every kill attempt.
  }
  return env.SRS_NODE_COUNT;
}
