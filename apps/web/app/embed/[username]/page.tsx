import { EmbedOfflineNotice } from "@/components/EmbedOfflineNotice";
import { VideoPlayer } from "@/components/VideoPlayer";
import { getLiveStreamByUsername } from "@/lib/api";
import styles from "./page.module.css";

// D.3 embed target: deliberately no TopNav/BottomNav/chat/chrome — this is
// what ShareSheet's "Embed" iframe snippet points at, meant to be dropped
// into someone else's page (a blog post, a Discord widget, etc).
//
// ?ticket=<jwt>: a PPV access token from POST /streams/:id/ppv/purchase —
// this page is commonly loaded inside a third-party <iframe>, where the
// viewer's birq.live session cookie (SameSite=lax) typically isn't sent,
// so the normal cookie-based access check alone would wrongly gate a
// paying viewer here. No purchase UI in this context (an iframe usually
// can't complete an account-gated wallet purchase) — a gated stream with
// no valid ticket just tells the viewer where to go buy one.
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ ticket?: string }>;
}) {
  const { username } = await params;
  const { ticket } = await searchParams;
  const stream = await getLiveStreamByUsername(username, ticket);

  if (!stream) {
    return <EmbedOfflineNotice username={username} />;
  }

  if (stream.isPpv && !stream.hasPpvAccess) {
    return (
      <div className={styles.wrap}>
        <p>
          This is a ticketed stream. Watch at{" "}
          <a href={`https://birq.live/watch/${username}`} target="_blank" rel="noreferrer">
            birq.live/watch/{username}
          </a>{" "}
          to buy access.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <VideoPlayer src={stream.playbackUrl} streamId={stream.id} />
    </div>
  );
}
