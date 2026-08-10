import type { LiveStream } from "@birq/shared";
import Link from "next/link";
import { formatViewerCount } from "@/lib/format";
import styles from "./StreamCard.module.css";
import { PersonIcon } from "./icons";

export function StreamCard({ stream }: { stream: LiveStream }) {
  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.card}>
      {/* .card establishes the container query context (container-type) but
          can't restyle its own display/flex-direction in response to its own
          query — that's a real CSS container-query self-reference
          restriction, not a bug (verified: an isolated parent-container/
          child-restyled test worked immediately; a self-querying element
          silently never matched). .cardInner is the actual element whose
          layout flips between vertical/horizontal, since it's a distinct
          descendant of the container, not the container itself. */}
      <div className={styles.cardInner}>
        <div className={styles.thumbnailWrap}>
          {stream.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={stream.thumbnailUrl} alt="" className={styles.thumbnail} />
          ) : (
            <div className={styles.thumbnailPlaceholder} />
          )}
          <span className={styles.liveBadge}>Live</span>
          {stream.isBoosted && <span className={styles.boostedBadge}>Boosted</span>}
          {stream.isSensitive && <span className={styles.sensitiveBadge}>Sensitive</span>}
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
            {stream.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
