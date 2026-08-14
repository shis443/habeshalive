import Link from "next/link";
import type { LiveStream } from "@birq/shared";
import styles from "./LiveRowCompact.module.css";

export function LiveRowCompact({ stream }: { stream: LiveStream }) {
  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.row}>
      <div className={styles.thumbWrap}>
        {stream.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stream.thumbnailUrl} alt="" className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder} />
        )}
        <div className={styles.liveOverlay}>
          <span className={styles.liveDot} />
          <span className={styles.viewerCount}>{stream.viewerCount}</span>
        </div>
      </div>
      <div className={styles.info}>
        <div className={styles.metaTop}>
          <img src={stream.creator.avatarUrl ?? "/avatar-fallback.png"} alt="" className={styles.avatar} />
          <div className={styles.titleColumn}>
            <div className={styles.creatorName}>{stream.creator.displayName}</div>
            <div className={styles.streamTitle}>{stream.title}</div>
          </div>
        </div>
        <div className={styles.metaBottom}>
          <span className={styles.category}>{stream.category ?? ""}</span>
          {stream.language && <span className={styles.language}>{stream.language}</span>}
          {stream.tags && stream.tags.length > 0 && (
            <span className={styles.tags}>{stream.tags.slice(0, 2).join(", ")}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default LiveRowCompact;
