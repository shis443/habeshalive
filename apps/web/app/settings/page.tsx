import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { NotificationPreferencesSection } from "@/components/NotificationPreferencesSection";
import { PreferencesSection } from "@/components/PreferencesSection";
import { SessionsSection } from "@/components/SessionsSection";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getNotificationPreferences } from "@/lib/api";
import styles from "../account/page.module.css";
import sectionStyles from "@/components/AccountSection.module.css";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/settings");

  const notificationPrefs = await getNotificationPreferences();

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Settings</h1>
        <PreferencesSection isAuthed />
        {notificationPrefs && <NotificationPreferencesSection initial={notificationPrefs} />}
        <div className={sectionStyles.card}>
          <h2 className={sectionStyles.title}>Security</h2>
          <p className={sectionStyles.hint}>
            Two-factor authentication — [CONFIRM] deferred to post-launch, not built yet.
          </p>
        </div>
        <SessionsSection />
      </main>
      <BottomNav />
    </>
  );
}
