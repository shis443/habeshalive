import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipPlayer } from "@/components/ClipPlayer";
import { ShareSheet } from "@/components/ShareSheet";
import { resolveAvatarUrl } from "@/lib/avatar";
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
// card is what makes a stranger tap through, not the URL text).
//
// Phase 3.3 — clip.ogImageUrl is now a real ffmpeg-generated 1200x630
// frame from the clip itself (clip-service.ts's runFfmpegOgImage), not a
// placeholder. Falls back to the creator's avatar only if generation
// failed at creation time (ogImageUrl null — see createClip's fail-open
// handling) — resolveAvatarUrl matters here specifically because
// creatorAvatarUrl is a path relative to the API origin, not an absolute
// URL; og:image/twitter:image need one directly, there's no browser
// context here to resolve a relative path against like <img src> gets.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const clip = await getPublicClip(id);
  if (!clip) return { title: "Clip not found — Birq" };

  const title = clip.title ?? `${clip.creatorDisplayName} on Birq`;
  const description = `Watch @${clip.creatorUsername}'s clip on Birq${clip.category ? ` — ${clip.category}` : ""}.`;
  const url = `${SITE_URL}/clip/${clip.id}`;
  const previewImage = clip.ogImageUrl ?? resolveAvatarUrl(clip.creatorAvatarUrl);

  return {
    title: `${title} — Birq`,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Birq",
      type: "video.other",
      images: previewImage ? [{ url: previewImage }] : [],
      videos: [{ url: clip.playbackUrl }],
    },
    twitter: {
      card: "player",
      title,
      description,
      images: previewImage ? [previewImage] : [],
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
