"use client";

import type { PublicClip } from "@birq/shared";
import type { MouseEvent } from "react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/format";
import styles from "./ClipFeedCard.module.css";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ClipFeedCard({ clip }: { clip: PublicClip }) {
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/clip/${clip.id}` : `/clip/${clip.id}`;

  async function handleShare(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const shareData = {
      title: clip.title ?? "Birq clip",
      text: clip.title ?? "Check out this Birq clip",
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch (_error) {
      // Fall through to the copy-link fallback below.
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (_error) {
      // Ignore clipboard failures: the link still exists and the card still works.
    }
  }

  return (
    <Link href={`/clip/${clip.id}`} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.creatorWrap}>
          {clip.creatorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clip.creatorAvatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder} />
          )}
          <div className={styles.creatorMeta}>
            <span className={styles.creatorName}>{clip.creatorDisplayName}</span>
            <span className={styles.metaLine}>{formatRelativeTime(clip.createdAt)}</span>
          </div>
        </div>
        {clip.category && <span className={styles.category}>{clip.category}</span>}
      </div>

      <div className={styles.mediaWrap}>
        {clip.ogImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.ogImageUrl} alt="" className={styles.media} />
        ) : (
          <div className={styles.mediaPlaceholder} />
        )}
        <span className={styles.views}>{clip.views.toLocaleString()} views</span>
        <span className={styles.duration}>{formatDuration(clip.durationSeconds)}</span>
      </div>

      {clip.title && <p className={styles.title}>{clip.title}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.shareButton} onClick={handleShare}>
          Share
        </button>
      </div>
    </Link>
  );
}
