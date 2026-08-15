import Link from "next/link";
import type { ContentCategory } from "@birq/shared";
import { CategoryFollowButton } from "@/components/CategoryFollowButton";
import styles from "./CategoryHero.module.css";

export default function CategoryHero({
  category,
  followerCount,
  liveViewerCount,
  isAuthed,
  initialFollowing,
}: {
  category: ContentCategory;
  followerCount: number;
  liveViewerCount: number;
  isAuthed: boolean;
  initialFollowing: boolean;
}) {
  return (
    <div className={styles.hero}>
      <div className={styles.imageWrap}>
        {category.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={category.artworkUrl} alt="" className={styles.image} />
        ) : (
          <div className={styles.placeholder} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.rowTop}>
          <h1 className={styles.title}>{category.name}</h1>
          <CategoryFollowButton category={category.name} isAuthed={isAuthed} initialFollowing={initialFollowing} />
        </div>
        <div className={styles.statsRow}>
          <div className={styles.statBlock}>
            <div className={styles.statCount}>{liveViewerCount}</div>
            <div className={styles.statLabel}>watching now</div>
          </div>
          <div className={styles.statBlock}>
            <div className={styles.statCount}>{followerCount}</div>
            <div className={styles.statLabel}>{followerCount === 1 ? "follower" : "followers"}</div>
          </div>
        </div>
        {category.description && <p className={styles.description}>{category.description}</p>}
        {category.tags && category.tags.length > 0 && (
          <div className={styles.tagsRow}>
            {category.tags.map((t) => (
              <Link key={t} href={`/discover?tag=${encodeURIComponent(t)}`} className={styles.tag}>
                {t}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
