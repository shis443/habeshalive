import { redirect } from "next/navigation";
import { AddFundsSection } from "@/components/AddFundsSection";
import { BalanceCard } from "@/components/BalanceCard";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { TransactionsList } from "@/components/TransactionsList";
import { getCurrentUser, getTransactions, getWalletBalance } from "@/lib/api";
import styles from "./page.module.css";

export default async function WalletPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/wallet");

  const [balance, transactions] = await Promise.all([getWalletBalance(), getTransactions()]);

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>My wallet</h1>
        <BalanceCard
          balanceSantim={balance?.balanceSantim ?? 0}
          weeklyDeltaSantim={balance?.weeklyDeltaSantim ?? 0}
        />
        <AddFundsSection />
        <TransactionsList transactions={transactions ?? []} />
      </main>
      <BottomNav active="wallet" />
    </>
  );
}
