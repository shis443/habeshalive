// Deterministic (not random) generated-art system for the fixed
// STREAM_CATEGORIES list — no cover-image upload pipeline exists for
// categories yet (content_categories.artwork_url is real but unpopulated,
// see docs/FLUTTER_UI_REBUILD_AUDIT.md's "Category data decision"), so
// this is the honest fallback: a stable gradient keyed off the category
// name, shared by every card that renders a category (CategoryTile,
// CategoryRowCompact, CategoryRailCard, CategoryHero) so the same
// category always gets the same art everywhere it appears.
export const GRADIENT_VARIANTS = ["variantA", "variantB", "variantC", "variantD"] as const;
export type GradientVariant = (typeof GRADIENT_VARIANTS)[number];

// Explicit, not hashed: a 4-bucket hash over the 4 known categories
// collided in practice (confirmed live — "Gaming" and "Traditional"
// landed on the same variant). A direct map guarantees each known
// category gets a distinct variant; anything added later without an
// entry here still gets a deterministic, collision-tolerant hash
// fallback.
const KNOWN_CATEGORY_VARIANTS: Record<string, GradientVariant> = {
  Music: "variantB",
  Gaming: "variantD",
  Traditional: "variantA",
  "Just Chatting": "variantC",
};

export function gradientVariantFor(category: string): GradientVariant {
  const known = KNOWN_CATEGORY_VARIANTS[category];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return GRADIENT_VARIANTS[hash % GRADIENT_VARIANTS.length]!;
}
