import Link from "next/link";
import type { ContentCategory } from "@birq/shared";
import styles from "./CategoryRailCard.module.css";

export default function CategoryRailCard({ category }: { category: ContentCategory }) {
  return (
    <Link href={`/category/${encodeURIComponent(category.slug)}`} className={styles.card}>
      <div className={styles.imageWrap}>
        {category.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={category.artworkUrl} alt="" className={styles.image} />
        ) : (
          <div className={styles.placeholder} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{category.name}</div>
        <div className={styles.meta}>
          <span className={styles.views}>{category.liveViewerCount ?? 0} watching</span>
        </div>
      </div>
    </Link>
  );
}
