import type { StreamDetail } from "@habeshalive/shared";
import { resolveAvatarUrl } from "@/lib/avatar";
import { formatViewerCount } from "@/lib/format";
import styles from "./StreamMeta.module.css";
import { PersonIcon, VerifiedIcon } from "./icons";
import { StreamDurationTimer } from "./StreamDurationTimer";

export function StreamMeta({ stream }: { stream: StreamDetail }) {
  const avatarUrl = resolveAvatarUrl(stream.creator.avatarUrl);
  return (
    <div className={styles.wrap}>
      <div className={styles.creatorRow}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarPlaceholder} />
        )}
        <div className={styles.headerInfo}>
          <p className={styles.creatorName}>
            {stream.creator.displayName}
            <VerifiedIcon className={styles.verifiedIcon} />
          </p>
          <div className={styles.statusRow}>
            <span className={styles.liveBadge}>Live</span>
            <span className={styles.viewerCount}>
              <PersonIcon />
              {formatViewerCount(stream.viewerCount)} watching
            </span>
            {stream.startedAt && (
              <span className={styles.duration}>
                <StreamDurationTimer startedAt={stream.startedAt} />
              </span>
            )}
          </div>
        </div>
      </div>
      <h1 className={styles.title}>{stream.title}</h1>
      <div className={styles.tags}>
        {stream.category && <span className={styles.tag}>{stream.category}</span>}
        {stream.language && <span className={styles.tag}>{stream.language}</span>}
      </div>
    </div>
  );
}
