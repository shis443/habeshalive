"use client";

import type { LiveStream } from "@birq/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatViewerCount } from "@/lib/format";
import { StreamCardPreview } from "../StreamCardPreview";
import { MediaStatusOverlay } from "./MediaStatusOverlay";
import { MetadataChip } from "./MetadataChip";
import styles from "./LiveCardLarge.module.css";
import { PersonIcon } from "../icons";

// live_tile_large.dart: full-width thumbnail (reference uses
// screenHeight/4, a mobile-viewport-relative unit with no responsive-web
// equivalent — aspect-ratio:16/9 is the real translation, see
// docs/FLUTTER_UI_REBUILD_AUDIT.md), LIVE badge top-left, viewer pill
// bottom-left, 50x50 avatar, name/title/category text stack, tag row.
// Reuses StreamCardPreview (the same real hover-preview HLS decode
// StreamCard already had) rather than dropping that feature while
// rebuilding the surrounding card.
const VISIBILITY_THRESHOLD = 0.6;

export function LiveCardLarge({ stream }: { stream: LiveStream }) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !stream.playbackUrl) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry?.isIntersecting ?? false),
      { threshold: VISIBILITY_THRESHOLD }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [stream.playbackUrl]);

  useEffect(() => {
    if (!isVisible) setIsPreviewPlaying(false);
  }, [isVisible]);

  const handlePreviewPlaying = useCallback(() => setIsPreviewPlaying(true), []);

  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.card} ref={cardRef}>
      <div className={styles.thumbnailWrap}>
        {stream.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stream.thumbnailUrl}
            alt=""
            className={`${styles.thumbnail} ${isPreviewPlaying ? styles.thumbnailHidden : ""}`}
          />
        ) : (
          <div className={`${styles.thumbnailPlaceholder} ${isPreviewPlaying ? styles.thumbnailHidden : ""}`} />
        )}
        {isVisible && stream.playbackUrl && (
          <StreamCardPreview playbackUrl={stream.playbackUrl} active={isVisible} onPlaying={handlePreviewPlaying} />
        )}
        <MediaStatusOverlay position="top-left" variant="live">
          Live
        </MediaStatusOverlay>
        <MediaStatusOverlay position="bottom-left" variant="dark">
          <PersonIcon />
          {formatViewerCount(stream.viewerCount)}
        </MediaStatusOverlay>
        {stream.isBoosted && (
          <MediaStatusOverlay position="top-right" variant="dark">
            Boosted
          </MediaStatusOverlay>
        )}
      </div>
      <div className={styles.body}>
        {stream.creator.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stream.creator.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder} />
        )}
        <div className={styles.info}>
          <p className={styles.creatorName}>{stream.creator.displayName}</p>
          <p className={styles.title}>{stream.title}</p>
          {stream.category && <p className={styles.category}>{stream.category}</p>}
        </div>
      </div>
      {(stream.language || stream.tags.length > 0) && (
        <div className={styles.tags}>
          {stream.language && <MetadataChip>{stream.language}</MetadataChip>}
          {stream.tags.slice(0, 4).map((tag) => (
            <MetadataChip key={tag}>{tag}</MetadataChip>
          ))}
        </div>
      )}
    </Link>
  );
}
