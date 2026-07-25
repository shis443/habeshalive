import { formatSantimAsBirr } from "@habeshalive/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { BrowserGoLivePanel } from "@/components/BrowserGoLivePanel";
import { GoLiveButton } from "@/components/GoLiveButton";
import { ModerationPanel } from "@/components/ModerationPanel";
import { StatCard } from "@/components/StatCard";
import { StreamSetupPanel } from "@/components/StreamSetupPanel";
import { TopNav } from "@/components/TopNav";
import { WalletPanel } from "@/components/WalletPanel";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  getCreatorStats,
  getCurrentUser,
  getEarningsThisMonth,
  getLiveStreamByUsername,
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

        <GoLiveButton displayName={user.displayName} isLive={!!liveStream} />

        <div className={styles.statGrid}>
          <StatCard
            label="Earnings this month"
            value={formatSantimAsBirr(earnings?.amountSantim ?? 0)}
          />
          <StatCard label="Followers" value={String(stats?.followerCount ?? 0)} />
          <StatCard label="Stream hours" value={`${stats?.streamHoursTotal ?? 0}h`} />
        </div>

        {streamKey && (
          <>
            <StreamSetupPanel rtmpUrl={streamKey.rtmpUrl} streamKey={streamKey.streamKey} />
            <BrowserGoLivePanel streamKey={streamKey.streamKey} displayName={user.displayName} />
          </>
        )}
        <WalletPanel balanceSantim={balance?.balanceSantim ?? 0} />
        <ModerationPanel />
      </main>
      <BottomNav active="go-live" />
    </>
  );
}
