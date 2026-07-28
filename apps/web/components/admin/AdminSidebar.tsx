"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AdminSidebar.module.css";

// Only sections that are actually built get a link — the rest of the
// architecture doc's nav tree (Anchor Creator Program, Settings, Audit Log
// frontend) lands in Phase 4. A dead link that says "coming soon" is
// exactly the anti-pattern this build has been fixing elsewhere — don't
// reintroduce it here.
// "Flagged content" (the automated blocklist-match queue, already built
// pre-dating this doc) isn't one of the four named subsections below — it
// lives at the parent /admin/moderation URL instead, since it needs a
// home and the doc's own "Reports queue" description already blurs the
// line between it and user-submitted reports.
const MODERATION_SUBSECTIONS = [
  { href: "/admin/moderation/reports", label: "Reports queue" },
  { href: "/admin/moderation/appeals", label: "Appeals queue" },
  { href: "/admin/moderation/history", label: "Action history" },
  { href: "/admin/moderation/blocklist", label: "Blocklist" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const inModeration = pathname.startsWith("/admin/moderation");

  return (
    <nav className={styles.sidebar}>
      <Link href="/admin" className={pathname === "/admin" ? styles.linkActive : styles.link}>
        Overview
      </Link>
      <Link href="/admin/payouts" className={pathname.startsWith("/admin/payouts") ? styles.linkActive : styles.link}>
        Payouts
      </Link>
      <Link href="/admin/moderation" className={inModeration ? styles.linkActive : styles.link}>
        Moderation
      </Link>
      {inModeration && (
        <div className={styles.subNav}>
          {MODERATION_SUBSECTIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? styles.subLinkActive : styles.subLink}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
      <Link
        href="/admin/live-streams"
        className={pathname.startsWith("/admin/live-streams") ? styles.linkActive : styles.link}
      >
        Live Streams
      </Link>
      <Link href="/admin/ledger" className={pathname.startsWith("/admin/ledger") ? styles.linkActive : styles.link}>
        Ledger &amp; Finance
      </Link>
      <Link href="/admin/creators" className={pathname.startsWith("/admin/creators") ? styles.linkActive : styles.link}>
        Creators
      </Link>
      <Link href="/admin/users" className={pathname.startsWith("/admin/users") ? styles.linkActive : styles.link}>
        Users
      </Link>
      <Link href="/admin/boosts" className={pathname.startsWith("/admin/boosts") ? styles.linkActive : styles.link}>
        Boosts
      </Link>
      <Link
        href="/admin/subscriptions"
        className={pathname.startsWith("/admin/subscriptions") ? styles.linkActive : styles.link}
      >
        Subscriptions
      </Link>
    </nav>
  );
}
