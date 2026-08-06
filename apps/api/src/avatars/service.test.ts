import type { AvatarCategory } from "@habeshalive/shared";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestViewer } from "../test/fixtures.js";
import { getUserSelection, listParts, randomizeSelection, renderUserAvatar, saveSelection } from "./service.js";

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
