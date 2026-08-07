import { formatSantimAsBirr } from "@habeshalive/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdsManagerPanel } from "@/components/AdsManagerPanel";
import { BottomNav } from "@/components/BottomNav";
import { ClipCreatorPanel } from "@/components/ClipCreatorPanel";
import { GoLivePanel } from "@/components/GoLivePanel";
import { ModerationPanel } from "@/components/ModerationPanel";
import { StatCard } from "@/components/StatCard";
import { StreamEndedPrompt } from "@/components/StreamEndedPrompt";
import { TopNav } from "@/components/TopNav";
import { WalletPanel } from "@/components/WalletPanel";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  getCreatorAdsSettings,
  getCreatorStats,
  getCurrentUser,
  getEarningsThisMonth,
  getLiveStreamByUsername,
  getMyVods,
  getStreamKey,
  getWalletBalance,
} from "@/lib/api";
import styles from "./page.module.css";

const DEFAULT_AVATAR_URL = resolveAvatarUrl("/avatars/render/00000000-0000-0000-0000-000000000000.svg");

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/dashboard");

  const [streamKey, balance, earnings, stats, liveStream] = await Promise.all([
    getStreamKey(),
    getWalletBalance(),
    getEarningsThisMonth(),
    getCreatorStats(),
    getLiveStreamByUsername(user.username),
  ]);
  // Ads Manager only makes sense once someone actually has creator access
  // (same gate GoLivePanel below already keys off streamKey for) — no
  // point fetching it for a viewer who can't stream yet.
  const adsSettings = streamKey ? await getCreatorAdsSettings() : null;
  // Same gate — only a creator can have VODs at all. Fetched once here,
  // not separately per section: draftVods filters to !isPublished for
  // StreamEndedPrompt (which only ever has to think about "here are
  // drafts to show", not the isPublished distinction), myVods is the
  // full list ClipCreatorPanel picks a source VOD from (a clip can come
  // from a published or draft recording either way).
  const myVods = streamKey ? await getMyVods() : [];
  const draftVods = myVods.filter((v) => !v.isPublished);

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Dashboard</h1>
        <p className={styles.subtext}>Manage your stream, earnings, and moderation settings.</p>

        <div className={styles.profileRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveAvatarUrl(user.avatarUrl) ?? DEFAULT_AVATAR_URL!} alt="" className={styles.profileAvatar} />
          <Link href="/avatar" className={styles.editAvatarLink}>
            Edit Avatar
          </Link>
        </div>

        <div className={styles.statGrid}>
          <StatCard
            label="Earnings this month"
            value={formatSantimAsBirr(earnings?.amountSantim ?? 0)}
          />
          <StatCard label="Followers" value={String(stats?.followerCount ?? 0)} />
          <StatCard label="Stream hours" value={`${stats?.streamHoursTotal ?? 0}h`} />
        </div>

        {draftVods.length > 0 && <StreamEndedPrompt drafts={draftVods} />}

        {streamKey && (
          <GoLivePanel
            rtmpUrl={streamKey.rtmpUrl}
            streamKey={streamKey.streamKey}
            displayName={user.displayName}
            initialIsLive={!!liveStream}
          />
        )}
        {streamKey && myVods.length > 0 && <ClipCreatorPanel vods={myVods} />}
        <WalletPanel balanceSantim={balance?.balanceSantim ?? 0} />
        <AdsManagerPanel settings={adsSettings} />
        <ModerationPanel creatorId={user.id} />
      </main>
      <BottomNav active="go-live" />
    </>
  );
}
