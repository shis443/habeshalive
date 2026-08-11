import { notFound } from "next/navigation";
import { getPublicClip } from "@/lib/api";
import styles from "./page.module.css";

// Mirrors app/embed/[username]/page.tsx's deliberately chrome-less
// pattern — this is what app/clip/[id]/page.tsx's ShareSheet "Embed"
// iframe snippet points at. No attribution/share UI here on purpose: a
// third party embedding this already links back to the real clip page
// around it.
export default async function ClipEmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await getPublicClip(id);

  if (!clip) return notFound();

  return (
    <div className={styles.wrap}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={clip.playbackUrl} controls playsInline autoPlay muted />
    </div>
  );
}
