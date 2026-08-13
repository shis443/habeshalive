"use client";

import type { LiveStream } from "@birq/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatViewerCount } from "@/lib/format";
import styles from "./StreamCard.module.css";
import { PersonIcon } from "./icons";
import { StreamCardPreview } from "./StreamCardPreview";

// Twitch-style directory behavior: a card shows its static thumbnail
// (or, absent one, a plain placeholder) until it's actually on screen,
// then starts a muted preview and cross-fades once it's really playing
// — not the instant it's requested, since hls.js/native HLS both take a
// moment to buffer the first frames, and swapping visuals before that
// would show a black flash instead of a smooth transition. Torn down the
// moment the card leaves the viewport (StreamCardPreview's own effect
// cleanup), so scrolling a long grid doesn't accumulate live decoders
// for cards nobody's looking at anymore.
const VISIBILITY_THRESHOLD = 0.6;

export function StreamCard({ stream }: { stream: LiveStream }) {
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

  // Reset immediately on losing visibility rather than waiting for the
  // preview's own unmount-driven fade — otherwise a quick scroll-past-
  // and-back could show a stale "playing" cross-fade state for a video
  // element that's already been torn down.
  useEffect(() => {
    if (!isVisible) setIsPreviewPlaying(false);
  }, [isVisible]);

  const handlePreviewPlaying = useCallback(() => setIsPreviewPlaying(true), []);

  return (
    <Link href={`/watch/${stream.creator.username}`} className={styles.card} ref={cardRef}>
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
