import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { KycSection } from "@/components/KycSection";
import { NotificationPreferencesSection } from "@/components/NotificationPreferencesSection";
import { PreferencesSection } from "@/components/PreferencesSection";
import { SessionsSection } from "@/components/SessionsSection";
import { TopNav } from "@/components/TopNav";
import { TotpSection } from "@/components/TotpSection";
import { getCurrentUser, getMyKycStatus, getNotificationPreferences, getTotpStatus } from "@/lib/api";
import styles from "../account/page.module.css";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/settings");

  const notificationPrefs = await getNotificationPreferences();
  const totpStatus = await getTotpStatus();
  const kycStatus = await getMyKycStatus();

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Settings</h1>
        <PreferencesSection isAuthed />
        {notificationPrefs && <NotificationPreferencesSection initial={notificationPrefs} />}
        <TotpSection initialEnabled={totpStatus?.enabled ?? false} />
        <KycSection initial={kycStatus} />
        <SessionsSection />
      </main>
      <BottomNav />
    </>
  );
}
