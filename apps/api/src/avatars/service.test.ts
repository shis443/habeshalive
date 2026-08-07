import type { AvatarCategory } from "@habeshalive/shared";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestViewer } from "../test/fixtures.js";

// Module 5 — real object storage isn't configured in this test env
// (VOD_S3_* unset), which would make uploadAvatarPhoto 503 immediately.
// Mocked with an in-memory Map, same reasoning/pattern as vods/
// clip-service.test.ts's uploadObjectMock. Rekognition's client already
// self-stubs to an empty-labels response when AWS_REKOGNITION_ACCESS_KEY_ID
// is unset (image-moderation-client.ts), so flagIfImageMatched needs no
// mock of its own. Only the photo tests below actually exercise this —
// the pre-existing generated-avatar tests never touch object storage.
const photoStore = new Map<string, { buffer: Buffer; contentType: string }>();

vi.mock("../common/object-storage.js", () => ({
  isObjectStorageConfigured: true,
  uploadObject: vi.fn(async (key: string, body: Buffer, contentType: string) => {
    photoStore.set(key, { buffer: body, contentType });
    return key;
  }),
  getObjectBuffer: vi.fn(async (key: string) => {
    const entry = photoStore.get(key);
    if (!entry) throw new Error("not found");
    return { buffer: entry.buffer, contentType: entry.contentType };
  }),
  deleteObject: vi.fn(async (key: string) => {
    photoStore.delete(key);
  }),
}));

import {
  getAvatarPhoto,
  getUserSelection,
  listParts,
  randomizeSelection,
  renderUserAvatar,
  revertToGeneratedAvatar,
  saveSelection,
  uploadAvatarPhoto,
} from "./service.js";

const ALL_CATEGORIES = [
  "background",
  "skin_tone",
  "hair",
  "hair_color",
  "eyes",
  "eyebrows",
  "mouth",
  "facial_hair",
  "accessories",
  "clothing",
  "clothes_color",
] as const;

// Categories where every real seeded option has swatch_color = null (a
// style key like "curly", not a color) — see db/migrations/0029_
// avataaars_render.sql. randomizeSelection used to treat a null
// swatchColor as "this pick means unset" (a leftover from the old flat-
// swatch model's "None" rows) which would have made every pick in these
// categories silently resolve to null.
const STYLE_ONLY_CATEGORIES: AvatarCategory[] = [
  "hair",
  "eyes",
  "eyebrows",
  "mouth",
  "facial_hair",
  "accessories",
  "clothing",
];

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  photoStore.clear();
});

async function getAvatarUrl(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = $1`, [
    userId,
  ]);
  return rows[0]!.avatar_url;
}

describe("listParts", () => {
  it("returns real, non-empty seeded options for all 11 categories", async () => {
    const manifest = await listParts();
    for (const category of ALL_CATEGORIES) {
      expect(manifest[category]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("style categories have no swatch color; color categories do", async () => {
    const manifest = await listParts();
    for (const category of STYLE_ONLY_CATEGORIES) {
      for (const part of manifest[category] ?? []) {
        expect(part.swatchColor).toBeNull();
      }
    }
    for (const part of manifest.hair_color ?? []) {
      expect(part.swatchColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("randomizeSelection", () => {
  it("always picks a real part for every category, never null — regression test for the swatchColor-null bug", async () => {
    // Run several times — randomize is, by definition, non-deterministic,
    // so a single call passing wouldn't rule out "sometimes null".
    for (let i = 0; i < 10; i++) {
      const selection = await randomizeSelection();
      for (const category of ALL_CATEGORIES) {
        expect(selection[category]).not.toBeNull();
        expect(typeof selection[category]).toBe("string");
      }
    }
  });
});

describe("saveSelection / getUserSelection / renderUserAvatar", () => {
  it("round-trips a real selection and renders a real SVG from it", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    const randomPicks = await randomizeSelection();
    const saved = await saveSelection(viewer.id, randomPicks);
    for (const category of ALL_CATEGORIES) {
      expect(saved[category]).toBe(randomPicks[category]);
    }

    const fetched = await getUserSelection(viewer.id);
    expect(fetched).toEqual(saved);

    const svg = await renderUserAvatar(viewer.id);
    expect(svg.trim().startsWith("<svg")).toBe(true);
    expect(svg.length).toBeGreaterThan(1000); // a real composed avatar, not an empty shell
  });

  it("renders a coherent default avatar for a user with no selections at all", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    const svg = await renderUserAvatar(viewer.id);
    expect(svg.trim().startsWith("<svg")).toBe(true);
    expect(svg.length).toBeGreaterThan(1000);
  });

  it("null in the selection payload clears that category", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    await saveSelection(viewer.id, await randomizeSelection());
    await saveSelection(viewer.id, { hair: null });

    const fetched = await getUserSelection(viewer.id);
    expect(fetched.hair).toBeNull();
  });
});

describe("uploadAvatarPhoto", () => {
  it("uploads a photo, points avatar_url at the stable proxy path, and serves it back unchanged", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    const buffer = Buffer.from("fake-jpeg-bytes");

    const result = await uploadAvatarPhoto(viewer.id, buffer, "image/jpeg");

    expect(result.avatarUrl).toBe(`/avatars/photo/${viewer.id}`);
    expect(await getAvatarUrl(viewer.id)).toBe(`/avatars/photo/${viewer.id}`);

    const photo = await getAvatarPhoto(viewer.id);
    expect(photo.buffer.equals(buffer)).toBe(true);
    expect(photo.contentType).toBe("image/jpeg");
  });

  it("rejects a disallowed content type", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await expect(uploadAvatarPhoto(viewer.id, Buffer.from("x"), "image/gif")).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects an empty file", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await expect(uploadAvatarPhoto(viewer.id, Buffer.alloc(0), "image/jpeg")).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects a file over the 5MB limit", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(uploadAvatarPhoto(viewer.id, big, "image/jpeg")).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });
});

describe("getAvatarPhoto", () => {
  it("404s when no photo has been uploaded", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await expect(getAvatarPhoto(viewer.id)).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("revertToGeneratedAvatar", () => {
  it("resets avatar_url to the generated SVG path and deletes the uploaded object", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await uploadAvatarPhoto(viewer.id, Buffer.from("fake-png-bytes"), "image/png");

    await revertToGeneratedAvatar(viewer.id);

    expect(await getAvatarUrl(viewer.id)).toBe(`/avatars/render/${viewer.id}.svg`);
    await expect(getAvatarPhoto(viewer.id)).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});
