import Link from "next/link";
import styles from "./ChannelTabs.module.css";

const TABS = [
  { value: "home", label: "Home" },
  { value: "about", label: "About" },
  { value: "videos", label: "Videos" },
  { value: "clips", label: "Clips" },
] as const;

export type ChannelTab = (typeof TABS)[number]["value"];

// Plain Link-based tabs, same pattern as CategoryPills.tsx — a real,
// shareable/bookmarkable ?tab= URL rather than client-side-only state, and
// no JS needed for the tab switch itself to work (this page is otherwise
// entirely server-rendered for the offline path it's used on).
//
// Four tabs, not the six in a typical Twitch layout (Home/About/Clips/
// Videos/Schedule/Chat) — Schedule has no backend concept whatsoever
// (omitted rather than adding a second undiscussed placeholder), and Chat
// is already always visible inline while a stream is live in this app's
// existing architecture, with no offline-chat concept to put behind a
// tab. Clips (Phase 3.2) reuses FeaturedClips.tsx as its own tab now,
// same component as the Home-tab preview — same "component keeps its own
// heading even under a like-named tab" precedent PastBroadcasts.tsx
// already set for Videos.
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
