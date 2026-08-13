import Link from "next/link";
import { formatViewerCount } from "@/lib/format";
import styles from "./CategoryTile.module.css";

// Deterministic (not random) generated-art system for the 4 fixed
// STREAM_CATEGORIES — no cover-image upload pipeline or admin CMS exists
// for categories today (see docs/TWITCH_REFERENCE_FEATURE_AUDIT.md's
// "Category data decision"), so this is the real, honest alternative to
// either faking photographic art or leaving categories with no visual
// identity at all: a stable gradient + initial, keyed off the category
// name so the same category always renders the same art everywhere it
// appears (Browse's grid, Discover's rail, the category header).
const GRADIENT_VARIANTS = ["variantA", "variantB", "variantC", "variantD"] as const;

// Explicit, not hashed: STREAM_CATEGORIES is a fixed 4-value list
// (packages/shared/src/constants.ts) and a 4-bucket hash over 4 items
// collides often (confirmed live — a naive char-code hash put both
// "Gaming" and "Traditional" in the same bucket, rendering visually
// identical tiles). A direct map guarantees each known category gets a
// distinct variant; any category added later without an entry here still
// gets a deterministic, collision-tolerant fallback via the hash.
const KNOWN_CATEGORY_VARIANTS: Record<string, (typeof GRADIENT_VARIANTS)[number]> = {
  Music: "variantB",
  Gaming: "variantD",
  Traditional: "variantA",
  "Just Chatting": "variantC",
};

function gradientVariantFor(category: string): (typeof GRADIENT_VARIANTS)[number] {
  const known = KNOWN_CATEGORY_VARIANTS[category];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return GRADIENT_VARIANTS[hash % GRADIENT_VARIANTS.length]!;
}

export function CategoryTile({
  category,
  href,
  liveViewerCount,
}: {
  category: string;
  href: string;
  // Real aggregate the caller computes from an already-fetched GET
  // /streams/live result — undefined (not 0) means "not computed by this
  // caller," which renders no viewer line at all rather than a misleading
  // "0 watching".
  liveViewerCount?: number;
}) {
  const variant = gradientVariantFor(category);
  return (
    <Link href={href} className={styles.tile}>
      <div className={`${styles.art} ${styles[variant]}`} aria-hidden="true">
        <span className={styles.initial}>{category.charAt(0)}</span>
      </div>
      <div className={styles.info}>
        <p className={styles.name}>{category}</p>
        {liveViewerCount !== undefined && liveViewerCount > 0 && (
          <p className={styles.meta}>{formatViewerCount(liveViewerCount)} watching</p>
        )}
      </div>
    </Link>
  );
}
