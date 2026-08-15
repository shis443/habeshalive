import type { PublicVod } from "@birq/shared";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/format";
import styles from "./VodCardReference.module.css";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VodCardReference({ vod }: { vod: PublicVod }) {
  return (
    <Link href={`/watch/${vod.creatorUsername}`} className={styles.card}>
      <div className={styles.thumbnailWrap}>
        {vod.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vod.thumbnailUrl} alt="" className={styles.thumbnail} />
        ) : (
          <div className={styles.thumbnailPlaceholder} />
        )}
        {formatDuration(vod.durationSeconds) && <span className={styles.duration}>{formatDuration(vod.durationSeconds)}</span>}
        <span className={styles.views}>{vod.views.toLocaleString()} views</span>
        <span className={styles.date}>{formatRelativeTime(vod.createdAt)}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.avatarRow}>
          {vod.creatorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vod.creatorAvatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder} />
          )}
          <div className={styles.userMeta}>
            <span className={styles.creatorName}>{vod.creatorDisplayName}</span>
            {vod.category && <span className={styles.category}>{vod.category}</span>}
          </div>
        </div>
        <p className={styles.title}>{vod.title}</p>
      </div>
    </Link>
  );
}
