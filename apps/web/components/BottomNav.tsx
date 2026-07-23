import Link from "next/link";
import styles from "./BottomNav.module.css";
import { ExploreIcon, FollowingIcon, GoLiveIcon, WalletIcon } from "./icons";

type NavTab = "explore" | "following" | "go-live" | "wallet";

const TABS: { id: NavTab; label: string; href: string; icon: (props: { className?: string }) => JSX.Element }[] = [
  { id: "explore", label: "Explore", href: "/", icon: ExploreIcon },
  { id: "following", label: "Following", href: "/following", icon: FollowingIcon },
  { id: "go-live", label: "Go live", href: "/dashboard", icon: GoLiveIcon },
  { id: "wallet", label: "Wallet", href: "/wallet", icon: WalletIcon },
];

export function BottomNav({ active }: { active?: NavTab }) {
  return (
    <nav className={styles.nav}>
      {TABS.map(({ id, label, href, icon: Icon }) => (
        <Link key={id} href={href} className={id === active ? styles.itemActive : styles.item}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
