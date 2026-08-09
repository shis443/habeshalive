"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./CreatorDashboardSidebar.module.css";
import { GearIcon, GiftIcon, GoLiveIcon, GroupIcon, HomeIcon, PlayIcon, ShieldIcon, VerifiedIcon, WalletIcon } from "./icons";

// Same principle as AdminSidebar.tsx's own comment: only sections that
// are actually built get a link. Twitch's real Creator Dashboard also has
// Analytics (Research/Achievements/Discovery/Engagement), Video
// Collections, a Copyright Claims Manager, Channel Points/Drops, and an
// Extensions marketplace — none of those have any backing feature or
// data source in this codebase (no event/analytics pipeline, no content-
// ID system, no third-party extension SDK, no game-publisher Drops
// partnerships), so they're deliberately not represented here rather than
// linking to a page that would either 404 or show fabricated numbers.
const COMMUNITY_SUBSECTIONS = [
  { href: "/dashboard/community/followers", label: "Followers" },
  { href: "/dashboard/community/my-roles", label: "My Assigned Roles" },
];

export function CreatorDashboardSidebar() {
  const pathname = usePathname();
  const inCommunity = pathname.startsWith("/dashboard/community");

  return (
    <nav className={styles.sidebar}>
      <Link href="/dashboard" className={pathname === "/dashboard" ? styles.linkActive : styles.link}>
        <HomeIcon />
        Home
      </Link>
      <Link
        href="/dashboard/stream-manager"
        className={pathname.startsWith("/dashboard/stream-manager") ? styles.linkActive : styles.link}
      >
        <GoLiveIcon />
        Stream Manager
      </Link>
      <Link href="/dashboard/content" className={pathname.startsWith("/dashboard/content") ? styles.linkActive : styles.link}>
        <PlayIcon />
        Content
      </Link>
      <Link href="/dashboard/community" className={inCommunity ? styles.linkActive : styles.link}>
        <GroupIcon />
        Community
      </Link>
      {inCommunity && (
        <div className={styles.subNav}>
          {COMMUNITY_SUBSECTIONS.map((item) => (
            <Link key={item.href} href={item.href} className={pathname === item.href ? styles.subLinkActive : styles.subLink}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
      <Link
        href="/dashboard/monetization"
        className={pathname.startsWith("/dashboard/monetization") ? styles.linkActive : styles.link}
      >
        <WalletIcon />
        Monetization
      </Link>
      <Link
        href="/dashboard/moderation"
        className={pathname.startsWith("/dashboard/moderation") ? styles.linkActive : styles.link}
      >
        <ShieldIcon />
        Moderation
      </Link>
      <Link
        href="/dashboard/viewer-rewards"
        className={pathname.startsWith("/dashboard/viewer-rewards") ? styles.linkActive : styles.link}
      >
        <GiftIcon />
        Viewer Rewards
      </Link>

      <div className={styles.divider} />

      <Link href="/settings?tab=profile" className={styles.link}>
        <GearIcon />
        Channel Settings
      </Link>
      <Link href="/safety-center" className={styles.link}>
        <VerifiedIcon />
        Safety Center
      </Link>
    </nav>
  );
}
