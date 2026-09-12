import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { env } from "../common/env.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { forceEndStream } from "./service.js";

// Regression suite for the Sev 1 defect: forceEndStream marked a stream
// 'ended' in Postgres and returned success without ever contacting the
// media server, so the encoder stayed connected and HLS kept cutting
// segments while the admin was told the broadcast had stopped.

const createdUserIds: string[] = [];
const createdStreamIds: string[] = [];

afterAll(async () => {
  if (createdStreamIds.length > 0) {
    // stream_controls cascades on stream delete; ledger rows are untouched.
    await pool.query(`DELETE FROM streams WHERE id = ANY($1::uuid[])`, [createdStreamIds]);
  }
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

const realNodeCount = env.SRS_NODE_COUNT;

function setNodeCount(n: number) {
  // env.ts parses process.env once at import, so vi.stubEnv("SRS_NODE_COUNT")
  // never reaches this value — the parsed object is what the service reads.
  (env as { SRS_NODE_COUNT: number }).SRS_NODE_COUNT = n;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setNodeCount(realNodeCount);
});

async function createAdmin(): Promise<TestUser> {
  const admin = await createTestViewer();
  createdUserIds.push(admin.id);
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

async function createLiveStream(): Promise<{ streamId: string; creatorId: string }> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, status, started_at)
     VALUES ($1, 'force-end test', 'live', now()) RETURNING id`,
    [creator.id]
  );
  const streamId = rows[0]!.id;
  createdStreamIds.push(streamId);
  return { streamId, creatorId: creator.id };
}

/**
 * SRS reachable, reporting one publisher under `name`, DELETE succeeding.
 * Mirrors the shape SRS's /api/v1/clients/ actually returns.
 */
function stubSrsWithPublisher(name: string) {
  const deleted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.includes("/api/v1/clients/?")) {
        return new Response(
          JSON.stringify({ server: "srs-1", clients: [{ id: "c-42", name, publish: true }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (href.includes("/api/v1/clients/") && init?.method === "DELETE") {
        deleted.push(href);
        // SRS's real shape for a successful kill: HTTP 200, {"code":0}.
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    })
  );
  return deleted;
}

describe("forceEndStream", () => {
  it("drops the publisher at the media server and records enforcement", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    const deleted = stubSrsWithPublisher(creatorId);

    const result = await forceEndStream(streamId, admin.id, "test: confirmed kill");

    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(1);
    // The kill actually went out — this is the assertion the old code could
    // never have passed, because it made no request at all.
    expect(deleted).toHaveLength(1);

    const { rows } = await pool.query<{ killed: boolean; enforced_at: string | null; reason: string }>(
      `SELECT killed, enforced_at, reason FROM stream_controls WHERE stream_id = $1`,
      [streamId]
    );
    expect(rows[0]!.killed).toBe(true);
    expect(rows[0]!.enforced_at).not.toBeNull();
    expect(rows[0]!.reason).toBe("test: confirmed kill");
  });

  it("throws and leaves enforcement pending when the media server is unreachable", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    await expect(forceEndStream(streamId, admin.id, "test: unreachable")).rejects.toBeInstanceOf(AppError);

    const { rows } = await pool.query<{ enforced_at: string | null; last_error: string | null }>(
      `SELECT enforced_at, last_error FROM stream_controls WHERE stream_id = $1`,
      [streamId]
    );
    // Intent is durable even though enforcement failed — this is what the
    // reconciler retries and what the admin UI renders as "requested".
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enforced_at).toBeNull();
    expect(rows[0]!.last_error).toContain("unreachable");
  });

  it("treats zero connected publishers as enforced", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ server: "srs-1", clients: [] }), { status: 200 }))
    );

    const result = await forceEndStream(streamId, admin.id, "test: nobody connected");

    // Nothing to kill IS the goal state; reporting failure here would train
    // admins to ignore the warning that matters.
    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(0);
  });
});

describe("stream_controls constraints", () => {
  it("rejects a control with no reason", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await expect(
      pool.query(
        `INSERT INTO stream_controls (stream_id, killed, applied_by) VALUES ($1, TRUE, $2)`,
        [streamId, admin.id]
      )
    ).rejects.toThrow(/reason/i);
  });

  it("rejects a non-positive bitrate cap", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await expect(
      pool.query(
        `INSERT INTO stream_controls (stream_id, reason, applied_by, bitrate_cap_kbps)
         VALUES ($1, 'test', $2, 0)`,
        [streamId, admin.id]
      )
    ).rejects.toThrow(/bitrate_cap_kbps/i);
  });
});

// Regression suite for the load-balancer hole found by inspecting
// infra/haproxy/haproxy.cfg against a running local cluster: RTMP
// publishers are placed by `leastconn` (one node), while the admin API is
// balanced `roundrobin`. A kill that queried the wrong node saw an empty
// client list and, treating that as "nothing to kill", reported the stream
// stopped while it was still broadcasting on the other node.
describe("killPublisherConfirmed behind a load balancer", () => {
  /**
   * Two nodes, round-robin. Only srs-2 hosts the publisher — exactly the
   * production topology. Odd-numbered listings come from srs-1 (empty).
   */
  function stubTwoNodeCluster(name: string) {
    const state = { listings: 0, deletes: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        if (href.includes("/api/v1/clients/?")) {
          state.listings++;
          const onSrs1 = state.listings % 2 === 1;
          return new Response(
            JSON.stringify(
              onSrs1
                ? { server: "srs-1", clients: [] }
                : { server: "srs-2", clients: [{ id: "c-7", name, publish: true }] }
            ),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (init?.method === "DELETE") {
          state.deletes++;
          // First DELETE lands on the wrong node. SRS's real behavior,
          // confirmed live against a running instance: HTTP 200 with
          // {"code":2049} (ERROR_RTMP_CLIENT_NOT_FOUND) — never a 404. A
          // naive `res.ok` check would misread this as success; the retry
          // must survive it by reading the body's code.
          return new Response(
            JSON.stringify({ code: state.deletes === 1 ? 2049 : 0 }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      })
    );
    return state;
  }

  it("finds and kills a publisher hosted on a node the first poll missed", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    setNodeCount(2);
    const state = stubTwoNodeCluster(creatorId);

    const result = await forceEndStream(streamId, admin.id, "test: two-node cluster");

    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(1);
    // Proof it actually looked past the first empty node.
    expect(state.listings).toBeGreaterThan(1);
    expect(state.deletes).toBeGreaterThan(1);
  });

  it("refuses to confirm when it cannot reach every node", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    setNodeCount(2);
    // Only ever one node answers, and it has no publisher. Concluding
    // "stopped" from this is the exact bug — it must report unconfirmed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ server: "srs-1", clients: [] }), { status: 200 }))
    );

    await expect(forceEndStream(streamId, admin.id, "test: partial cluster")).rejects.toThrow(
      /only reached 1 of 2/i
    );
  });
});

// Regression suite for the fast path added after finding SRS's on_publish
// hook already sends client_id/server_id (srs_app_http_hooks.cpp) — using
// it directly, instead of searching the cluster by stream name, closes a
// real race: a name-based search can be confused by a creator's encoder
// reconnecting mid-kill, since SRS assigns a fresh client_id per
// connection. Also exercises parseSrsDeleteResult's {"code":0} contract
// directly, since the fallback suite above already covers {"code":2049}.
describe("killPublisherConfirmed with a known client_id", () => {
  it("targets the known id directly, without listing the cluster at all", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    await pool.query(`UPDATE streams SET srs_client_id = 'c-known-1' WHERE id = $1`, [streamId]);

    let listCalls = 0;
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        if (href.includes("/api/v1/clients/?")) {
          listCalls++;
          return new Response(JSON.stringify({ server: "srs-1", clients: [] }), { status: 200 });
        }
        if (init?.method === "DELETE") {
          deleted.push(href);
          return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const result = await forceEndStream(streamId, admin.id, "test: known client id fast path");

    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(1);
    expect(deleted).toEqual([expect.stringContaining("/api/v1/clients/c-known-1")]);
    // The point of the fast path: it never lists the cluster at all.
    expect(listCalls).toBe(0);
    void creatorId;
  });

  it("is not fooled by a stale client_id if the session already ended (code 2049)", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await pool.query(`UPDATE streams SET srs_client_id = 'c-gone' WHERE id = $1`, [streamId]);
    setNodeCount(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: 2049 }), { status: 200 }))
    );

    const result = await forceEndStream(streamId, admin.id, "test: already gone");

    // Not found IS the goal state — the session had already ended by the
    // time the kill ran. Reporting failure here would be exactly the kind
    // of false alarm that trains admins to ignore real ones.
    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(0);
  });

  it("retries a known client_id past a wrong-node miss before confirming absence", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await pool.query(`UPDATE streams SET srs_client_id = 'c-live-elsewhere' WHERE id = $1`, [streamId]);
    setNodeCount(2);

    let deletes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deletes++;
          // Reachable on the second attempt (the "other" node).
          return new Response(JSON.stringify({ code: deletes === 1 ? 2049 : 0 }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const result = await forceEndStream(streamId, admin.id, "test: known id, wrong node first");

    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(1);
    expect(deletes).toBe(2);
  });

  it("falls back to cluster search when no client_id was ever captured", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    // srs_client_id is NULL by default — a WHIP session, or a row
    // predating migration 0051.
    const deleted = stubSrsWithPublisher(creatorId);

    const result = await forceEndStream(streamId, admin.id, "test: no captured identity");

    expect(result.enforced).toBe(true);
    expect(result.killed).toBe(1);
    expect(deleted).toHaveLength(1);
  });
});
