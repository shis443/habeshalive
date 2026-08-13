import type { ContentCategory } from "@birq/shared";
import Link from "next/link";
import { formatViewerCount } from "@/lib/format";
import { gradientVariantFor } from "@/lib/categoryArt";
import { MetadataChip } from "./MetadataChip";
import styles from "./CategoryRowCompact.module.css";

// categories_tile_small.dart: 50x80 cover image, Row layout (image left,
// info right) — the direct fix for the "giant 3:4 generated-gradient
// card" complaint on Browse's Categories tab. Real content_categories
// data (migration 0046): name, live-viewer count, real tags — no
// hardcoded copy. artworkUrl is real when set, falling back to the same
// generated-gradient system CategoryTile/CategoryRailCard/CategoryHero
// share (lib/categoryArt.ts) when it's null.
export function CategoryRowCompact({ category }: { category: ContentCategory }) {
  const variant = gradientVariantFor(category.slug);
  return (
    <Link href={`/category/${encodeURIComponent(category.slug)}`} className={styles.row}>
      <div className={styles.artWrap}>
        {category.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={category.artworkUrl} alt="" className={styles.artImage} />
        ) : (
          <div className={`${styles.art} ${styles[variant]}`} aria-hidden="true">
            <span className={styles.initial}>{category.name.charAt(0)}</span>
          </div>
        )}
      </div>
      <div className={styles.info}>
        <p className={styles.name}>{category.name}</p>
        <p className={styles.meta}>
          {category.liveViewerCount > 0
            ? `${formatViewerCount(category.liveViewerCount)} watching`
            : `${formatViewerCount(category.followerCount)} ${category.followerCount === 1 ? "follower" : "followers"}`}
        </p>
        {category.tags.length > 0 && (
          <div className={styles.tags}>
            {category.tags.slice(0, 3).map((tag) => (
              <MetadataChip key={tag}>{tag}</MetadataChip>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
