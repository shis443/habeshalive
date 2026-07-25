import { ActionRow } from "@/components/ActionRow";
import { AboutCreator } from "@/components/AboutCreator";
import { BottomNav } from "@/components/BottomNav";
import { ChatPanel } from "@/components/ChatPanel";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { StreamMeta } from "@/components/StreamMeta";
import { TopNav } from "@/components/TopNav";
import { VideoPlayer } from "@/components/VideoPlayer";
import {
  getCurrentUser,
  getFollowStatus,
  getGiftTypes,
  getLiveStreamByUsername,
  getLiveStreams,
  getStreamActivity,
  getSubscriptionTiers,
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
    return (
      <>
        <TopNav isAuthed={!!user} />
        <div className={styles.offlineWrap}>
          <h1 className={styles.offlineTitle}>@{username} is not live right now</h1>
          <p className={styles.offlineText}>Check back later or explore other creators.</p>
        </div>
        <BottomNav />
      </>
    );
  }

  const [giftTypes, tiers, activity, followStatus] = await Promise.all([
    getGiftTypes(),
    getSubscriptionTiers(),
    getStreamActivity(stream.id),
    getFollowStatus(stream.creator.id),
  ]);

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={sidebarStreams} defaultCollapsed />
      <main className={styles.main}>
        <div className={styles.playerColumn}>
          <VideoPlayer src={stream.playbackUrl} />
          <div className={styles.body}>
            <StreamMeta stream={stream} />
            <ActionRow
              creatorId={stream.creator.id}
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
            viewerCount={stream.viewerCount}
            giftTypes={giftTypes}
            isAuthed={!!user}
            currentUsername={user?.username ?? null}
            activity={activity}
          />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
