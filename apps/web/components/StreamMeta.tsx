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
        {stream.tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
      {stream.isSensitive && (
        // Only opted-in viewers (or the creator) ever reach this page for a
        // sensitive stream — getLiveStreamByUsername 404s everyone else
        // before this component renders at all (streams/service.ts). This
        // banner is the missing "you're seeing this because you opted in"
        // context, not an access gate — the gate already happened.
        <p className={styles.sensitiveNotice}>
          This stream is labeled sensitive/mature content. You&apos;re seeing it because of your
          Labeled Content setting.
        </p>
      )}
    </div>
  );
}
