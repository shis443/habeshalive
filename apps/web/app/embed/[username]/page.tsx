import { EmbedOfflineNotice } from "@/components/EmbedOfflineNotice";
import { VideoPlayer } from "@/components/VideoPlayer";
import { getLiveStreamByUsername } from "@/lib/api";
import styles from "./page.module.css";

// D.3 embed target: deliberately no TopNav/BottomNav/chat/chrome — this is
// what ShareSheet's "Embed" iframe snippet points at, meant to be dropped
// into someone else's page (a blog post, a Discord widget, etc).
export default async function EmbedPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const stream = await getLiveStreamByUsername(username);

  if (!stream) {
    return <EmbedOfflineNotice username={username} />;
  }

  return (
    <div className={styles.wrap}>
      <VideoPlayer src={stream.playbackUrl} streamId={stream.id} />
    </div>
  );
}
