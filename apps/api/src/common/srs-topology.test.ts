import { afterEach, describe, expect, it } from "vitest";
import { env } from "./env.js";
import { resolveSrsNodeCount } from "./srs-topology.js";

const realBase = env.SRS_ADMIN_API_BASE;
const realCount = env.SRS_NODE_COUNT;

afterEach(() => {
  (env as { SRS_ADMIN_API_BASE: string }).SRS_ADMIN_API_BASE = realBase;
  (env as { SRS_NODE_COUNT: number }).SRS_NODE_COUNT = realCount;
});

describe("resolveSrsNodeCount", () => {
  it("falls back to SRS_NODE_COUNT when the host has no AAAA records", async () => {
    // Real DNS query, not mocked — dns.resolve6("localhost") is confirmed
    // live (outside this test) to reject with ESERVFAIL, since "localhost"
    // has no AAAA record. This is the actual dev/docker-compose case, not
    // a hypothetical: SRS_ADMIN_API_BASE's own default is
    // "http://localhost:1985".
    (env as { SRS_ADMIN_API_BASE: string }).SRS_ADMIN_API_BASE = "http://localhost:1985";
    (env as { SRS_NODE_COUNT: number }).SRS_NODE_COUNT = 3;

    await expect(resolveSrsNodeCount()).resolves.toBe(3);
  });

  it("falls back when SRS_ADMIN_API_BASE is not a parseable URL", async () => {
    (env as { SRS_ADMIN_API_BASE: string }).SRS_ADMIN_API_BASE = "not a url";
    (env as { SRS_NODE_COUNT: number }).SRS_NODE_COUNT = 2;

    await expect(resolveSrsNodeCount()).resolves.toBe(2);
  });
});
