import { formatSantimAsBirr } from "@birq/shared";
import Link from "next/link";
import { CheckIcon } from "@/components/icons";
import { StatCard } from "@/components/StatCard";
import { StreamEndedPrompt } from "@/components/StreamEndedPrompt";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  getCreatorStats,
  getCurrentUser,
  getEarningsThisMonth,
  getMyAccount,
  getMyKycStatus,
  getMyVods,
  getStreamKey,
} from "@/lib/api";
import styles from "./page.module.css";

const DEFAULT_AVATAR_URL = resolveAvatarUrl("/avatars/render/00000000-0000-0000-0000-000000000000.svg");

// Real onboarding checklist — every item below is a genuine, checkable
// fact (avatar_url set, bio set, KYC approved, at least one real stream
// recorded), not the kind of "Set customized chat rules" placeholder
// Twitch's dashboard shows for a feature (chat rules) this app doesn't
// have.
export default async function DashboardHomePage() {
  const user = await getCurrentUser();
  if (!user) return null; // layout.tsx already redirects; narrows the type below

  const [streamKey, earnings, stats, account, kycStatus] = await Promise.all([
    getStreamKey(),
    getEarningsThisMonth(),
    getCreatorStats(),
    getMyAccount(),
    getMyKycStatus(),
  ]);
  const myVods = streamKey ? await getMyVods() : [];
  const draftVods = myVods.filter((v) => !v.isPublished);

  const checklist = [
    { done: !!user.avatarUrl, label: "Set a profile avatar", href: "/avatar" },
    { done: !!account?.bio, label: "Add a bio", href: "/settings?tab=profile" },
    { done: (stats?.streamHoursTotal ?? 0) > 0, label: "Go live for the first time", href: "/dashboard/stream-manager" },
    { done: kycStatus?.status === "approved", label: "Verify your identity (required for payouts)", href: "/settings?tab=security" },
  ];

  return (
    <>
      <h1 className={styles.heading}>Welcome, {user.displayName}</h1>
      <p className={styles.subtext}>Manage your stream, earnings, and channel from here.</p>

      <div className={styles.profileRow}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolveAvatarUrl(user.avatarUrl) ?? DEFAULT_AVATAR_URL!} alt="" className={styles.profileAvatar} />
        <Link href="/avatar" className={styles.editAvatarLink}>
          Edit Avatar
        </Link>
      </div>

      <div className={styles.statGrid}>
        <StatCard label="Earnings this month" value={formatSantimAsBirr(earnings?.amountSantim ?? 0)} />
        <StatCard label="Followers" value={String(stats?.followerCount ?? 0)} />
        <StatCard label="Stream hours" value={`${stats?.streamHoursTotal ?? 0}h`} />
      </div>

      {draftVods.length > 0 && <StreamEndedPrompt drafts={draftVods} />}

      {!checklist.every((c) => c.done) && (
        <>
          <h2 className={styles.sectionTitle}>Get set up</h2>
          <div className={styles.checklist}>
            {checklist.map((item) => (
              <div key={item.label} className={styles.checklistItem}>
                <span className={item.done ? styles.checklistIconDone : styles.checklistIcon}>
                  <CheckIcon />
                </span>
                <span className={item.done ? styles.checklistDone : undefined}>{item.label}</span>
                {!item.done && (
                  <Link href={item.href} className={styles.checklistLink}>
                    Go
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
