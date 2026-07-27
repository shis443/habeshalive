import type { LiveStream } from "@habeshalive/shared";
import Link from "next/link";
import { formatViewerCount } from "@/lib/format";
import styles from "./StreamCard.module.css";
import { PersonIcon } from "./icons";

export function StreamCard({ stream }: { stream: LiveStream }) {
  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.card}>
      <div className={styles.thumbnailWrap}>
        {stream.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stream.thumbnailUrl} alt="" className={styles.thumbnail} />
        ) : (
          <div className={styles.thumbnailPlaceholder} />
        )}
        <span className={styles.liveBadge}>Live</span>
        {stream.isBoosted && <span className={styles.boostedBadge}>Boosted</span>}
        <span className={styles.viewerCount}>
          <PersonIcon />
          {formatViewerCount(stream.viewerCount)}
        </span>
      </div>
      <div className={styles.info}>
        <p className={styles.title}>{stream.title}</p>
        <p className={styles.creator}>{stream.creator.displayName}</p>
        <div className={styles.tags}>
          {stream.category && <span className={styles.tag}>{stream.category}</span>}
          {stream.language && <span className={styles.tag}>{stream.language}</span>}
        </div>
      </div>
    </Link>
  );
}
