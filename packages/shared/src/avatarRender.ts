import type { AvatarCategory } from "./schemas/avatars.js";

// Generates a flat-swatch placeholder avatar as an SVG string. This stands
// in for real layered character art — swapping in real PNG/SVG assets later
// only means changing this function, not the manifest/selection data model.
// Shared between the backend's persisted render and the editor's live
// preview so what you see while picking options exactly matches what gets
// saved.

export type AvatarColors = Record<AvatarCategory, string | null>;

const DEFAULT_BACKGROUND = "#171f33"; // surface-container
const DEFAULT_SKIN = "#a0785a";

export function renderAvatarSvg(colors: AvatarColors): string {
  const background = colors.background ?? DEFAULT_BACKGROUND;
  const skin = colors.skin_tone ?? DEFAULT_SKIN;

  const hairLayer = colors.hair
    ? `<path d="M40 95 A60 60 0 0 1 160 95 L160 60 A60 55 0 0 0 40 60 Z" fill="${colors.hair}" />`
    : "";

  const eyesLayer = colors.eyes
    ? `<circle cx="82" cy="105" r="6" fill="${colors.eyes}" /><circle cx="118" cy="105" r="6" fill="${colors.eyes}" />`
    : "";

  const accessoriesLayer = colors.accessories
    ? `<circle cx="55" cy="130" r="5" fill="${colors.accessories}" /><circle cx="145" cy="130" r="5" fill="${colors.accessories}" />`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="${background}" />
  <circle cx="100" cy="120" r="55" fill="${skin}" />
  ${hairLayer}
  ${eyesLayer}
  ${accessoriesLayer}
</svg>`;
}
