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
        return new Response("{}", { status: 200 });
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
          // First DELETE lands on the wrong node — SRS 404s on an unknown
          // client id. The retry must survive that.
          return new Response("{}", { status: state.deletes === 1 ? 404 : 200 });
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
