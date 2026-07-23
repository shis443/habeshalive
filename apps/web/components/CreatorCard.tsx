import type { CreatorSearchResult } from "@habeshalive/shared";
import Link from "next/link";
import styles from "./CreatorCard.module.css";

export function CreatorCard({ creator }: { creator: CreatorSearchResult }) {
  return (
    <Link href={`/watch/${creator.username}`} className={styles.card}>
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
