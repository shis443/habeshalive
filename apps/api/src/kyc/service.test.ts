import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";

// Real S3 credentials aren't available in this test environment (VOD_S3_*
// is unset — see .env.example), so isObjectStorageConfigured is false and
// submitKyc would 503 before ever reaching its own validation logic. This
// is the codebase's first use of vi.mock (existing tests avoid the
// object-storage dependency entirely — see vods/service.test.ts's own
// comment on the same constraint) — chosen over skipping submitKyc's real
// logic altogether, since content-type validation and the
// one-pending-submission rule are exactly what this file needs to verify.
const uploadObjectMock = vi.fn(async (key: string, _body: Buffer, _contentType: string) => key);
vi.mock("../common/object-storage.js", () => ({
  isObjectStorageConfigured: true,
  uploadObject: (...args: [string, Buffer, string]) => uploadObjectMock(...args),
  getSignedVodUrl: async (key: string) => `https://signed.example/${key}`,
}));

const { submitKyc, getMyKycStatus, hasApprovedKyc, listKycSubmissions, getKycDocumentUrl, approveKyc, rejectKyc } =
  await import("./service.js");

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function makeAdmin(): Promise<TestUser> {
  const admin = await trackUser(await createTestViewer());
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

const validJpeg = { buffer: Buffer.from([1, 2, 3, 4]), contentType: "image/jpeg" };

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  uploadObjectMock.mockClear();
});

describe("submitKyc", () => {
  it("rejects an unsupported content type", async () => {
    const user = await trackUser(await createTestViewer());
    await expect(submitKyc(user.id, "fayda", { buffer: Buffer.from("x"), contentType: "text/plain" })).rejects.toThrow(
      /JPEG, PNG, or PDF/
    );
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const user = await trackUser(await createTestViewer());
    await expect(submitKyc(user.id, "fayda", { buffer: Buffer.alloc(0), contentType: "image/jpeg" })).rejects.toThrow(
      /empty/
    );
  });

  it("rejects a file over the 10MB limit", async () => {
    const user = await trackUser(await createTestViewer());
    const big = { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: "image/jpeg" };
    await expect(submitKyc(user.id, "fayda", big)).rejects.toThrow(/too large/);
  });

  it("accepts a valid submission and reports it as pending", async () => {
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);

    const status = await getMyKycStatus(user.id);
    expect(status.status).toBe("pending");
    expect(status.idType).toBe("fayda");
  });

  it("rejects a second submission while one is already pending", async () => {
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);
    await expect(submitKyc(user.id, "kebele", validJpeg)).rejects.toThrow(/awaiting review/);
  });

  it("rejects submitting again once already approved", async () => {
    const admin = await makeAdmin();
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM kyc_submissions WHERE user_id = $1`,
      [user.id]
    );
    await approveKyc(admin.id, rows[0]!.id);

    await expect(submitKyc(user.id, "fayda", validJpeg)).rejects.toThrow(/already verified/);
  });
});

describe("getMyKycStatus", () => {
  it("reports not_submitted for a user who's never submitted", async () => {
    const user = await trackUser(await createTestViewer());
    const status = await getMyKycStatus(user.id);
    expect(status).toEqual({ status: "not_submitted", idType: null, rejectionReason: null, submittedAt: null });
  });
});

describe("hasApprovedKyc", () => {
  it("is false before submission and true only after approval", async () => {
    const admin = await makeAdmin();
    const user = await trackUser(await createTestViewer());
    expect(await hasApprovedKyc(user.id)).toBe(false);

    await submitKyc(user.id, "fayda", validJpeg);
    expect(await hasApprovedKyc(user.id)).toBe(false); // pending, not approved yet

    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM kyc_submissions WHERE user_id = $1`, [
      user.id,
    ]);
    await approveKyc(admin.id, rows[0]!.id);
    expect(await hasApprovedKyc(user.id)).toBe(true);
  });
});

describe("admin review", () => {
  it("rejectKyc records a reason and getMyKycStatus surfaces it", async () => {
    const admin = await makeAdmin();
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "kebele", validJpeg);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM kyc_submissions WHERE user_id = $1`, [
      user.id,
    ]);

    await rejectKyc(admin.id, rows[0]!.id, "Photo is blurry");

    const status = await getMyKycStatus(user.id);
    expect(status.status).toBe("rejected");
    expect(status.rejectionReason).toBe("Photo is blurry");

    // Resubmission after rejection is allowed — a fresh row, not blocked
    // by the "already have a pending submission" or "already approved" guards.
    await submitKyc(user.id, "kebele", validJpeg);
    expect((await getMyKycStatus(user.id)).status).toBe("pending");
  });

  it("approveKyc/rejectKyc 404 on an already-reviewed or nonexistent submission", async () => {
    const admin = await makeAdmin();
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM kyc_submissions WHERE user_id = $1`, [
      user.id,
    ]);
    const submissionId = rows[0]!.id;

    await approveKyc(admin.id, submissionId);
    await expect(approveKyc(admin.id, submissionId)).rejects.toThrow(AppError);
    await expect(rejectKyc(admin.id, submissionId, "too late")).rejects.toThrow(AppError);
    await expect(approveKyc(admin.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });

  it("listKycSubmissions filters by status and joins the submitter's username", async () => {
    const admin = await makeAdmin();
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);

    const pending = await listKycSubmissions("pending");
    const mine = pending.find((s) => s.userId === user.id);
    expect(mine).toBeDefined();
    expect(mine!.username).toBe(user.username);
    expect(mine!.idType).toBe("fayda");

    const approved = await listKycSubmissions("approved");
    expect(approved.find((s) => s.userId === user.id)).toBeUndefined();
  });

  it("getKycDocumentUrl returns a signed URL for a real submission and 404s otherwise", async () => {
    const user = await trackUser(await createTestViewer());
    await submitKyc(user.id, "fayda", validJpeg);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM kyc_submissions WHERE user_id = $1`, [
      user.id,
    ]);

    const url = await getKycDocumentUrl(rows[0]!.id);
    expect(url).toContain("https://signed.example/kyc/");

    await expect(getKycDocumentUrl("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });
});
