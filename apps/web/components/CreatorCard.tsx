import type { CreatorSearchResult } from "@birq/shared";
import Link from "next/link";
import styles from "./CreatorCard.module.css";

export function CreatorCard({
  creator,
  muteWhenOffline = false,
}: {
  creator: CreatorSearchResult;
  muteWhenOffline?: boolean;
}) {
  const cardClassName =
    muteWhenOffline && !creator.isLive ? `${styles.card} ${styles.cardOffline}` : styles.card;
  return (
    <Link href={`/watch/${creator.username}`} className={cardClassName}>
      <div className={styles.avatarWrap}>
        {creator.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder} />
        )}
        {creator.isLive && <span className={styles.liveBadge}>Live</span>}
      </div>
      <div className={styles.info}>
        <p className={styles.displayName}>{creator.displayName}</p>
        <p className={styles.username}>@{creator.username}</p>
        {creator.bio && <p className={styles.bio}>{creator.bio}</p>}
        {creator.category && <span className={styles.tag}>{creator.category}</span>}
      </div>
    </Link>
  );
}
