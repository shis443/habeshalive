import { redirect } from "next/navigation";
import { AccountDeletionSection } from "@/components/AccountDeletionSection";
import { ConnectedAccountsSection } from "@/components/ConnectedAccountsSection";
import { ContactSection } from "@/components/ContactSection";
import { BottomNav } from "@/components/BottomNav";
import { PasswordSection } from "@/components/PasswordSection";
import { ProfileSection } from "@/components/ProfileSection";
import { TopNav } from "@/components/TopNav";
import { UsernameSection } from "@/components/UsernameSection";
import { getAccountDeletionStatus, getCurrentUser, getLinkedSocialAccounts, getMyAccount } from "@/lib/api";
import styles from "./page.module.css";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/account");

  const [account, socialAccounts, deletionStatus] = await Promise.all([
    getMyAccount(),
    getLinkedSocialAccounts(),
    getAccountDeletionStatus(),
  ]);
  if (!account) redirect("/login?redirect=/account");

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Account</h1>
        <ProfileSection account={account} />
        <UsernameSection account={account} />
        <ContactSection account={account} />
        <PasswordSection hasPassword={account.hasPassword} />
        <ConnectedAccountsSection accounts={socialAccounts} hasPassword={account.hasPassword} hasPhoneOrEmail={!!account.phoneNumber || !!account.email} />
        <AccountDeletionSection status={deletionStatus} hasPassword={account.hasPassword} />
      </main>
      <BottomNav />
    </>
  );
}
