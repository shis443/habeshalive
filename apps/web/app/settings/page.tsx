import { redirect } from "next/navigation";
import { AccountDeletionSection } from "@/components/AccountDeletionSection";
import { BottomNav } from "@/components/BottomNav";
import { ConnectedAccountsSection } from "@/components/ConnectedAccountsSection";
import { ContactSection } from "@/components/ContactSection";
import { KycSection } from "@/components/KycSection";
import { NotificationPreferencesSection } from "@/components/NotificationPreferencesSection";
import { PasswordSection } from "@/components/PasswordSection";
import { PreferencesSection } from "@/components/PreferencesSection";
import { ProfileSection } from "@/components/ProfileSection";
import { SessionsSection } from "@/components/SessionsSection";
import { SettingsTabs, type SettingsTabId } from "@/components/SettingsTabs";
import { TopNav } from "@/components/TopNav";
import { TotpSection } from "@/components/TotpSection";
import { UsernameSection } from "@/components/UsernameSection";
import {
  getAccountDeletionStatus,
  getCurrentUser,
  getLinkedSocialAccounts,
  getMyAccount,
  getMyKycStatus,
  getNotificationPreferences,
  getTotpStatus,
} from "@/lib/api";
import styles from "./page.module.css";

const VALID_TABS: SettingsTabId[] = ["profile", "security", "notifications", "connections", "preferences"];

// Merges what used to be two separate pages (/account: profile, username,
// contact, password, connections, deletion — and /settings: preferences,
// notifications, 2FA, KYC, sessions) into one Twitch-style tabbed page.
// /account now just redirects here (see app/account/page.tsx) — every
// section component below is unchanged, this only changes how they're
// grouped and navigated between.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/settings");

  const { tab } = await searchParams;
  const initialTab: SettingsTabId = VALID_TABS.includes(tab as SettingsTabId) ? (tab as SettingsTabId) : "profile";

  const [account, socialAccounts, deletionStatus, notificationPrefs, totpStatus, kycStatus] = await Promise.all([
    getMyAccount(),
    getLinkedSocialAccounts(),
    getAccountDeletionStatus(),
    getNotificationPreferences(),
    getTotpStatus(),
    getMyKycStatus(),
  ]);
  if (!account) redirect("/login?redirect=/settings");

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Settings</h1>
        <SettingsTabs
          initialTab={initialTab}
          profile={
            <>
              <ProfileSection account={account} />
              <UsernameSection account={account} />
            </>
          }
          security={
            <>
              <ContactSection account={account} />
              <PasswordSection hasPassword={account.hasPassword} />
              <TotpSection initialEnabled={totpStatus?.enabled ?? false} />
              <KycSection initial={kycStatus} />
              <SessionsSection />
              <AccountDeletionSection status={deletionStatus} hasPassword={account.hasPassword} />
            </>
          }
          notifications={notificationPrefs ? <NotificationPreferencesSection initial={notificationPrefs} /> : null}
          connections={
            <ConnectedAccountsSection
              accounts={socialAccounts}
              hasPassword={account.hasPassword}
              hasPhoneOrEmail={!!account.phoneNumber || !!account.email}
            />
          }
          preferences={<PreferencesSection isAuthed />}
        />
      </main>
      <BottomNav />
    </>
  );
}
