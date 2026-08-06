import Link from "next/link";
import styles from "./ChannelTabs.module.css";

const TABS = [
  { value: "home", label: "Home" },
  { value: "about", label: "About" },
  { value: "videos", label: "Videos" },
] as const;

export type ChannelTab = (typeof TABS)[number]["value"];

// Plain Link-based tabs, same pattern as CategoryPills.tsx — a real,
// shareable/bookmarkable ?tab= URL rather than client-side-only state, and
// no JS needed for the tab switch itself to work (this page is otherwise
// entirely server-rendered for the offline path it's used on).
//
// Only three tabs, not the six in a typical Twitch layout (Home/About/
// Clips/Videos/Schedule/Chat) — Clips has no backing system at all in this
// codebase (shown as a placeholder section within Home instead, not a
// full tab of its own — see FeaturedClipsPlaceholder.tsx), Schedule has no
// backend concept whatsoever (omitted rather than adding a second
// undiscussed placeholder), and Chat is already always visible inline
// while a stream is live in this app's existing architecture, with no
// offline-chat concept to put behind a tab.
export function ChannelTabs({ username, active }: { username: string; active: ChannelTab }) {
  return (
    <nav className={styles.tabs}>
      {TABS.map((tab) => (
        <Link
          key={tab.value}
          href={tab.value === "home" ? `/watch/${username}` : `/watch/${username}?tab=${tab.value}`}
          className={`${styles.tab} ${active === tab.value ? styles.tabActive : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
