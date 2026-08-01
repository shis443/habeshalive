"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import styles from "./BottomNav.module.css";
import { ExploreIcon, FollowingIcon, GoLiveIcon, WalletIcon } from "./icons";

type NavTab = "explore" | "following" | "go-live" | "wallet";

const TABS: { id: NavTab; labelKey: string; href: string; icon: (props: { className?: string }) => JSX.Element }[] = [
  { id: "explore", labelKey: "explore", href: "/", icon: ExploreIcon },
  { id: "following", labelKey: "following", href: "/following", icon: FollowingIcon },
  { id: "go-live", labelKey: "goLive", href: "/dashboard", icon: GoLiveIcon },
  { id: "wallet", labelKey: "wallet", href: "/wallet", icon: WalletIcon },
];

export function BottomNav({ active }: { active?: NavTab }) {
  const t = useTranslations("nav");
  return (
    <nav className={styles.nav}>
      {TABS.map(({ id, labelKey, href, icon: Icon }) => (
        <Link key={id} href={href} className={id === active ? styles.itemActive : styles.item}>
          <Icon />
          <span>{t(labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
