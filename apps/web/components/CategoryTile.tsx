import Link from "next/link";
import { formatViewerCount } from "@/lib/format";
import { gradientVariantFor } from "@/lib/categoryArt";
import styles from "./CategoryTile.module.css";

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
