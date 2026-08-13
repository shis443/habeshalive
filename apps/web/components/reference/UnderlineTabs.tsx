import Link from "next/link";
import styles from "./UnderlineTabs.module.css";

export interface UnderlineTab {
  label: string;
  href: string;
  active: boolean;
}

// browse.dart / categories.dart's TabBar: labelColor/indicatorColor =
// twitchMainColor, indicatorSize: TabBarIndicatorSize.label (the
// underline is only as wide as the label text, not the full tab hit
// area — a real, specific difference from Birq's previous rounded-pill
// tabs). Real <Link>s with a real ?tab=/?view= URL each active state maps
// to, same "URL is the source of truth, no client tab state" pattern the
// rest of this app already uses (CategoryPills, the old browse/category
// tabs) — only the visual treatment changes here.
export function UnderlineTabs({ tabs }: { tabs: UnderlineTab[] }) {
  return (
    <nav className={styles.tabs}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={styles.tab} aria-current={tab.active ? "page" : undefined}>
          <span className={`${styles.label} ${tab.active ? styles.labelActive : ""}`}>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
