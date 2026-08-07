"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./SettingsTabs.module.css";

export type SettingsTabId = "profile" | "security" | "notifications" | "connections" | "preferences";

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security and Privacy" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "preferences", label: "Preferences" },
];

// All five tabs' content is server-rendered once by the /settings page
// (each section already does its own real data fetching server-side) and
// handed to this client component as plain ReactNode props — switching
// tabs just toggles which one is visible, no client-side re-fetch and no
// second round of loading states.
export function SettingsTabs({
  initialTab,
  profile,
  security,
  notifications,
  connections,
  preferences,
}: {
  initialTab: SettingsTabId;
  profile: ReactNode;
  security: ReactNode;
  notifications: ReactNode;
  connections: ReactNode;
  preferences: ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState<SettingsTabId>(initialTab);
  const content = { profile, security, notifications, connections, preferences };

  function selectTab(id: SettingsTabId) {
    setActive(id);
    // Keeps the tab bookmarkable/shareable (and is what lets
    // NotificationBell's gear icon deep-link straight to Notifications)
    // without a full navigation — scroll: false so switching tabs doesn't
    // yank the viewport back to the top of a long settings page.
    router.replace(`/settings?tab=${id}`, { scroll: false });
  }

  return (
    <>
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tab} ${active === tab.id ? styles.tabActive : ""}`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {content[active]}
    </>
  );
}
