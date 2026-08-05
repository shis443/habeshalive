import { ActionRow } from "@/components/ActionRow";
import { AboutCreator } from "@/components/AboutCreator";
import { AdDisplayBanner } from "@/components/AdDisplayBanner";
import { BottomNav } from "@/components/BottomNav";
import { ChatPanel } from "@/components/ChatPanel";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { PastBroadcasts } from "@/components/PastBroadcasts";
import { StreamMeta } from "@/components/StreamMeta";
import { TopNav } from "@/components/TopNav";
import { VideoPlayer } from "@/components/VideoPlayer";
import {
  getCurrentUser,
  getFollowStatus,
  getGiftTiers,
  getLiveStreamByUsername,
  getLiveStreams,
  getServedAd,
  getStreamActivity,
  getSubscriptionTiers,
  getVods,
} from "@/lib/api";
import styles from "./page.module.css";

export default async function WatchPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [stream, user, sidebarStreams] = await Promise.all([
    getLiveStreamByUsername(username),
    getCurrentUser(),
    getLiveStreams(),
  ]);

  if (!stream) {
    const vods = await getVods(username);
    return (
      <>
        <TopNav isAuthed={!!user} />
        <div className={styles.offlineWrap}>
          <h1 className={styles.offlineTitle}>@{username} is not live right now</h1>
          <p className={styles.offlineText}>Check back later or explore other creators.</p>
        </div>
        <PastBroadcasts vods={vods} />
        <BottomNav />
      </>
    );
  }

  const [giftTiers, tiers, activity, followStatus, displayAd] = await Promise.all([
    getGiftTiers(),
    getSubscriptionTiers(),
    getStreamActivity(stream.id),
    getFollowStatus(stream.creator.id),
    getServedAd(stream.id, "display_banner"),
  ]);

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={sidebarStreams} defaultCollapsed />
      <main className={styles.main}>
        <div className={styles.playerColumn}>
          <VideoPlayer src={stream.playbackUrl} />
          <div className={styles.body}>
            <AdDisplayBanner ad={displayAd} />
            <StreamMeta stream={stream} />
            <ActionRow
              streamId={stream.id}
              creatorId={stream.creator.id}
              creatorUsername={stream.creator.username}
              isAuthed={!!user}
              isFollowing={followStatus.following}
              isOwner={!!user && user.id === stream.creator.id}
              tiers={tiers}
            />
            <AboutCreator
              displayName={stream.creator.displayName}
              bio={stream.creator.bio}
              followerCount={followStatus.followerCount}
            />
          </div>
        </div>
        <div className={styles.chatColumn}>
          <ChatPanel
            streamId={stream.id}
            creatorId={stream.creator.id}
            viewerCount={stream.viewerCount}
            giftTiers={giftTiers}
            isAuthed={!!user}
            currentUsername={user?.username ?? null}
            currentUserId={user?.id ?? null}
            currentUserRole={user?.role ?? null}
            activity={activity}
          />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
