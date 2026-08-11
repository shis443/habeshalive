import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipPlayer } from "@/components/ClipPlayer";
import { ShareSheet } from "@/components/ShareSheet";
import { getPublicClip } from "@/lib/api";
import { SITE_URL } from "@/lib/config";
import styles from "./page.module.css";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Phase 3.1 — the actual distribution surface, not the clip page itself:
// without these tags a shared link is a bare URL and the growth loop this
// whole feature exists for doesn't close (a Telegram/WhatsApp preview
// card is what makes a stranger tap through, not the URL text). No
// dedicated clip-thumbnail generation exists in the backend yet — using
// the creator's avatar as og:image is a real stand-in, not a placeholder
// left silently broken: something recognizable beats a blank preview
// card, and it needs no code change to swap in a real generated
// thumbnail later (same "art-blocked, not code-blocked" posture as the
// avatar system elsewhere in this app).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const clip = await getPublicClip(id);
  if (!clip) return { title: "Clip not found — Birq" };

  const title = clip.title ?? `${clip.creatorDisplayName} on Birq`;
  const description = `Watch @${clip.creatorUsername}'s clip on Birq${clip.category ? ` — ${clip.category}` : ""}.`;
  const url = `${SITE_URL}/clip/${clip.id}`;

  return {
    title: `${title} — Birq`,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Birq",
      type: "video.other",
      images: clip.creatorAvatarUrl ? [{ url: clip.creatorAvatarUrl }] : [],
      videos: [{ url: clip.playbackUrl }],
    },
    twitter: {
      card: "player",
      title,
      description,
      images: clip.creatorAvatarUrl ? [clip.creatorAvatarUrl] : [],
    },
  };
}

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await getPublicClip(id);

  if (!clip) return notFound();

  return (
    <div className={styles.wrap}>
      <ClipPlayer src={clip.playbackUrl} clipId={clip.id} />

      <div className={styles.meta}>
        <Link href={`/watch/${clip.creatorUsername}`} className={styles.creatorRow}>
          {clip.creatorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clip.creatorAvatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder} />
          )}
          <div>
            <p className={styles.creatorName}>{clip.creatorDisplayName}</p>
            <p className={styles.creatorUsername}>@{clip.creatorUsername}</p>
          </div>
        </Link>

        {clip.title && <h1 className={styles.title}>{clip.title}</h1>}

        <div className={styles.statsRow}>
          {clip.category && <span className={styles.categoryPill}>{clip.category}</span>}
          <span>
            {clip.views.toLocaleString()} view{clip.views === 1 ? "" : "s"}
          </span>
          <span>{formatDuration(clip.durationSeconds)}</span>
          <span>{new Date(clip.createdAt).toLocaleDateString()}</span>
        </div>

        <div className={styles.actions}>
          <ShareSheet embedPath={`/embed/clip/${clip.id}`} />
          <Link href={`/watch/${clip.creatorUsername}`} className={styles.channelLink}>
            More from @{clip.creatorUsername} →
          </Link>
        </div>
      </div>
    </div>
  );
}
