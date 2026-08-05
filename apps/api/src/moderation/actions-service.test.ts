import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";
import { banUser, unbanUser } from "./actions-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createTestAdmin(): Promise<TestUser> {
  const admin = await createTestViewer();
  // 'super_admin', not 'admin' — db/migrations/0026_rbac_role_isolation.sql
  // renamed the role; 'admin' is no longer a valid users.role value.
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

async function getIsBanned(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ is_banned: boolean }>(`SELECT is_banned FROM users WHERE id = $1`, [
    userId,
  ]);
  return rows[0]!.is_banned;
}

// Default no-op fetch mock: real HTTP calls (Centrifugo disconnect, SRS
// admin API) must never actually leave the test process — every test
// below stubs `fetch` explicitly rather than relying on this reaching a
// real network, matching streams/service.test.ts's established pattern.
function stubEmptyFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = url.toString();
    // Empty client list means killActiveRtmpPublishers's filter never
    // matches anything, so no DELETE is ever issued — this single branch
    // covers both the GET and the (never-reached) DELETE case for SRS.
    if (href.includes("/api/v1/clients/")) {
      return new Response(JSON.stringify({ clients: [] }), { status: 200 });
    }
    // Centrifugo's disconnect API and anything else — a generic ok.
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("banUser", () => {
  it("sets is_banned and records a moderation_actions row", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());
    stubEmptyFetch();

    await banUser(admin.id, target.id, "spam");

    expect(await getIsBanned(target.id)).toBe(true);
    const { rows } = await pool.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM moderation_actions WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [target.id]
    );
    expect(rows[0]).toMatchObject({ action: "ban", reason: "spam" });
  });

  it("rejects banning a user who is already banned", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());
    stubEmptyFetch();

    await banUser(admin.id, target.id);
    await expect(banUser(admin.id, target.id)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
  });

  it("404s for an unknown target user", async () => {
    const admin = await trackUser(await createTestAdmin());
    stubEmptyFetch();

    await expect(banUser(admin.id, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("kills the banned user's active RTMP/WHIP publisher via SRS's admin API, ignoring non-matching and viewer clients", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.includes("/api/v1/clients/") && (!init || init.method === undefined)) {
        // The client list: one matching publisher (should be killed), one
        // matching *viewer* on the same stream name (publish: false —
        // must NOT be killed), one publisher on an unrelated stream (must
        // NOT be killed). `stream` here is deliberately SRS's internal
        // stream-object id (opaque, unrelated to `name`) — matching real
        // SRS responses (confirmed live against production, see
        // actions-service.ts's SrsClientEntry comment); `name` is the
        // actual match field.
        return new Response(
          JSON.stringify({
            clients: [
              { id: "111", stream: "vid-aaa111", name: target.id, publish: true },
              { id: "222", stream: "vid-bbb222", name: target.id, publish: false },
              { id: "333", stream: "vid-ccc333", name: "some-other-creator-id", publish: true },
            ],
          }),
          { status: 200 }
        );
      }
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      // Centrifugo disconnect call.
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await banUser(admin.id, target.id, "ToS violation");

    // killActiveRtmpPublishers is fire-and-forget (detached) inside
    // banUser — wait for its DELETE call to actually land rather than
    // asserting immediately after banUser resolves.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ href: `${env.SRS_ADMIN_API_BASE}/api/v1/clients/111` }),
        expect.objectContaining({ method: "DELETE" })
      );
    });

    // The viewer client (222) and the unrelated stream's publisher (333)
    // must never have been targeted.
    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
  });

  it("still bans the user even if SRS's admin API is completely unreachable", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    // The ban itself (the real security boundary — is_banned blocking
    // every future action) must succeed regardless of SRS/Centrifugo
    // being reachable. See actions-service.ts's adversarial-reasoning
    // comment block (point 3) for why this is fail-open by design.
    await expect(banUser(admin.id, target.id, "unreachable SRS test")).resolves.toBeUndefined();
    expect(await getIsBanned(target.id)).toBe(true);
  });
});

describe("unbanUser", () => {
  it("clears is_banned and records a moderation_actions row", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());
    stubEmptyFetch();

    await banUser(admin.id, target.id);
    await unbanUser(admin.id, target.id, "appeal approved");

    expect(await getIsBanned(target.id)).toBe(false);
    const { rows } = await pool.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM moderation_actions WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [target.id]
    );
    expect(rows[0]).toMatchObject({ action: "unban", reason: "appeal approved" });
  });

  it("rejects unbanning a user who is not banned", async () => {
    const admin = await trackUser(await createTestAdmin());
    const target = await trackUser(await createTestViewer());

    await expect(unbanUser(admin.id, target.id)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
  });
});
