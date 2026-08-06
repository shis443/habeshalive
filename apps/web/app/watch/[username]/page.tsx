import { ActionRow } from "@/components/ActionRow";
import { AboutCreator } from "@/components/AboutCreator";
import { AdDisplayBanner } from "@/components/AdDisplayBanner";
import { BottomNav } from "@/components/BottomNav";
import { ChannelHeader } from "@/components/ChannelHeader";
import { ChannelTabs, type ChannelTab } from "@/components/ChannelTabs";
import { ChatPanel } from "@/components/ChatPanel";
import { FeaturedClipsPlaceholder } from "@/components/FeaturedClipsPlaceholder";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { OfflineNotice } from "@/components/OfflineNotice";
import { PastBroadcasts } from "@/components/PastBroadcasts";
import { RecentCategoriesPlaceholder } from "@/components/RecentCategoriesPlaceholder";
import { StreamMeta } from "@/components/StreamMeta";
import { TopNav } from "@/components/TopNav";
import { VideoPlayer } from "@/components/VideoPlayer";
import {
  getCreatorProfile,
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

// How many VODs the Home tab shows as a teaser before pointing at the
// Videos tab for the rest — an arbitrary but reasonable "fits without
// scrolling" cutoff, same kind of number as PastBroadcasts.tsx's own grid
// sizing, not derived from anything.
const HOME_TAB_VOD_PREVIEW_COUNT = 4;

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { username } = await params;
  const [stream, user, sidebarStreams] = await Promise.all([
    getLiveStreamByUsername(username),
    getCurrentUser(),
    getLiveStreams(),
  ]);

  if (!stream) {
    const [vods, profile] = await Promise.all([getVods(username), getCreatorProfile(username)]);

    // Genuinely nonexistent username (not just "not live right now") —
    // getCreatorProfile (independent of live status) returns null only in
    // this case, unlike getLiveStreamByUsername above which returns null
    // for both. No header/tabs to show for a creator that doesn't exist.
    if (!profile) {
      return (
        <>
          <TopNav isAuthed={!!user} />
          <OfflineNotice username={username} />
          <BottomNav />
        </>
      );
    }

    const rawTab = (await searchParams).tab;
    const tab: ChannelTab = rawTab === "about" || rawTab === "videos" ? rawTab : "home";

    return (
      <>
        <TopNav isAuthed={!!user} />
        <OfflineNotice username={username} />
        <ChannelHeader profile={profile} isAuthed={!!user} />
        <ChannelTabs username={username} active={tab} />
        {tab === "home" && (
          <>
            <FeaturedClipsPlaceholder />
            <RecentCategoriesPlaceholder displayName={profile.displayName} />
            <PastBroadcasts vods={vods.slice(0, HOME_TAB_VOD_PREVIEW_COUNT)} />
          </>
        )}
        {tab === "about" && (
          <AboutCreator displayName={profile.displayName} bio={profile.bio} followerCount={profile.followerCount} />
        )}
        {tab === "videos" && <PastBroadcasts vods={vods} />}
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
          <VideoPlayer src={stream.playbackUrl} streamId={stream.id} />
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
