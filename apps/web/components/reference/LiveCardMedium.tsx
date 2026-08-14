import Link from "next/link";
import type { LiveStream } from "@birq/shared";
import styles from "./LiveCardMedium.module.css";

export default function LiveCardMedium({ stream }: { stream: LiveStream }) {
  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.card}>
      <div className={styles.thumbWrap}>
        {stream.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stream.thumbnailUrl} alt="" className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder} />
        )}
        <div className={styles.liveBadge}>LIVE</div>
        <div className={styles.viewerPill}>{stream.viewerCount}</div>
      </div>
      <div className={styles.meta}>
        <div className={styles.topRow}>
          <img src={stream.creator.avatarUrl ?? "/avatar-fallback.png"} className={styles.avatar} alt="" />
          <div className={styles.titleCol}>
            <div className={styles.creatorName}>{stream.creator.displayName}</div>
            <div className={styles.streamTitle}>{stream.title}</div>
          </div>
        </div>
        <div className={styles.bottomRow}>
          <span className={styles.category}>{stream.category ?? ""}</span>
          {stream.language && <span className={styles.language}>{stream.language}</span>}
        </div>
      </div>
    </Link>
  );
}
