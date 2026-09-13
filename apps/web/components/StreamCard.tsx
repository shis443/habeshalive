"use client";

import type { LiveStream } from "@birq/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatViewerCount } from "@/lib/format";
import { FollowButton } from "./FollowButton";
import { OverflowMenu } from "./OverflowMenu";
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

// Stops a click on an interactive child (Follow, the 3-dot menu) from
// also triggering the card's own <Link> navigation — preventDefault
// cancels the anchor's default action (a click anywhere inside an <a>
// navigates by default, regardless of which descendant was actually
// clicked), stopPropagation is a secondary guard against next/link's own
// click handler.
function stopCardNavigation(e: React.MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function StreamCard({
  stream,
  isAuthed,
  onDismissed,
}: {
  stream: LiveStream;
  isAuthed: boolean;
  // Called after this card's creator is blocked or dismissed as "not
  // interested" — lets ExploreGrid remove it from the grid immediately.
  onDismissed?: (creatorId: string) => void;
}) {
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

  const watchUrl = `/watch/${stream.creator.username}`;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${watchUrl}` : watchUrl;

  return (
    <Link href={watchUrl} className={styles.card} ref={cardRef}>
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
          {/* The card is a fixed 16:9 box with object-fit: cover, so a
              vertically-shot stream is centre-cropped here to keep the grid
              uniform. This says so, and signals that opening it gives the
              full-height 9:16 frame the player renders. Bottom-right because
              the other three corners are taken (live/boosted top-left,
              sensitive top-right, viewer count bottom-left). */}
          {stream.aspectRatio === "9:16" && (
            <span className={styles.portraitBadge} title="Vertical stream">
              Vertical
            </span>
          )}
          <span className={styles.viewerCount}>
            <PersonIcon />
            {formatViewerCount(stream.viewerCount)}
          </span>
        </div>
        <div className={styles.info}>
          <p className={styles.title}>{stream.title}</p>
          <div className={styles.creatorRow}>
            {stream.creator.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stream.creator.avatarUrl} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder} />
            )}
            <p className={styles.creator}>{stream.creator.displayName}</p>
            <div className={styles.creatorRowActions} onClick={stopCardNavigation}>
              <FollowButton
                creatorId={stream.creator.id}
                isAuthed={isAuthed}
                initialFollowing={stream.creator.isFollowing}
              />
              <OverflowMenu
                streamId={stream.id}
                creatorId={stream.creator.id}
                shareUrl={shareUrl}
                shareText={stream.title}
                isAuthed={isAuthed}
                onDismissed={() => onDismissed?.(stream.creator.id)}
              />
            </div>
          </div>
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
