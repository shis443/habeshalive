import { createAvatar } from "@dicebear/core";
import * as avataaars from "@dicebear/avataaars";
import type { Options as AvataaarsOptions } from "@dicebear/avataaars";
import type { AvatarCategory } from "./schemas/avatars.js";

// Real layered character art (@dicebear/avataaars — a headless, pure-SVG
// reimplementation of Pablo Stanley's "Avataaars" design, no React/DOM
// involved) replacing the original flat-swatch placeholder — see
// db/migrations/0029_avataaars_render.sql's comment for the full story.
// Still one function, still shared between the backend's persisted
// render (apps/api/src/avatars/service.ts) and the editor's live preview
// (AvatarPreviewHero.tsx's dangerouslySetInnerHTML), so what you see while
// picking options is pixel-identical to what gets saved — same contract
// the original placeholder had, just a real renderer underneath now.

// One value per BIRQ category: for a style category (hair/eyes/eyebrows/
// mouth/facialHair/accessories/clothing) this is the literal
// @dicebear/avataaars option key stored in avatar_parts.name (e.g.
// "curly", "happy") — see that migration's comment for why the key lives
// directly in `name` rather than a separate column. For a color category
// (background/skin_tone/hair_color/clothes_color) this is a "#rrggbb" hex
// string from avatar_parts.swatch_color, matching this table's existing
// convention from before this renderer swap.
export type AvatarValues = Record<AvatarCategory, string | null>;

// avatar_parts stores color values as "#rrggbb" (this table's convention
// since 0004_avatars.sql) but @dicebear/core's own convertColor always
// prepends "#" itself (confirmed against the installed package's
// utils/convertColor.js — it is not conditional), so a value arriving
// here already carrying "#" would come out "##rrggbb" if passed through
// unchanged.
function stripHash(hex: string): string {
  return hex.startsWith("#") ? hex.slice(1) : hex;
}

// Defaults for a category with no selection yet (new account, or one of
// the three categories 0029's migration cleared selections for) — same
// "always render something coherent, never a broken/half-composed
// avatar" reasoning the original placeholder's DEFAULT_BACKGROUND/
// DEFAULT_SKIN constants had, extended to every category since a real
// layered avatar can't sensibly omit a body part the way a flat shape
// layer could just not draw.
const DEFAULTS: AvatarValues = {
  background: "#171f33", // surface-container, matches the old placeholder default
  skin_tone: "#d08b5b", // "Brown" — verified against @dicebear/avataaars's real skin tone set
  hair: "shortRound",
  hair_color: "#4a312c", // "Brown Dark"
  eyes: "default",
  eyebrows: "default",
  mouth: "smile",
  facial_hair: "blank",
  accessories: "blank",
  clothing: "shirtCrewNeck",
  clothes_color: "#5199e4", // "Blue"
};

// avatar_parts.name is a plain DB string, not a literal union — there's
// no real end-to-end type safety to preserve here regardless (the actual
// guardrail is the CHECK constraint + curated seed data in
// db/migrations/0029_avataaars_render.sql, not TypeScript). This cast
// just satisfies @dicebear/avataaars's stricter Options type without
// repeating an "extract array element type" conditional for every field.
type Loose = Record<string, string[] | undefined>;

export function renderAvatarSvg(values: AvatarValues): string {
  const v = (category: AvatarCategory) => values[category] ?? DEFAULTS[category]!;

  const options: Loose = {
    style: ["circle"],
    backgroundColor: [stripHash(v("background"))],
    skinColor: [stripHash(v("skin_tone"))],
    top: [v("hair")],
    hairColor: [stripHash(v("hair_color"))],
    eyes: [v("eyes")],
    eyebrows: [v("eyebrows")],
    mouth: [v("mouth")],
    facialHair: [v("facial_hair")],
    accessories: [v("accessories")],
    clothing: [v("clothing")],
    clothesColor: [stripHash(v("clothes_color"))],
  };

  return createAvatar(avataaars, options as AvataaarsOptions).toString();
}
