import Link from "next/link";
import { redirect } from "next/navigation";
import { AddFundsSection } from "@/components/AddFundsSection";
import { BalanceCard } from "@/components/BalanceCard";
import { BottomNav } from "@/components/BottomNav";
import { MyGiftCardsList } from "@/components/MyGiftCardsList";
import { PointsCard } from "@/components/PointsCard";
import { SubscriptionsList } from "@/components/SubscriptionsList";
import { TopNav } from "@/components/TopNav";
import { TransactionsList } from "@/components/TransactionsList";
import {
  getCurrentUser,
  getMyGiftCards,
  getMySubscriptions,
  getPointsBalance,
  getTransactions,
  getWalletBalance,
} from "@/lib/api";
import styles from "./page.module.css";

export default async function WalletPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/wallet");

  const [balance, transactions, subscriptions, giftCards, pointsBalance] = await Promise.all([
    getWalletBalance(),
    getTransactions(),
    getMySubscriptions(),
    getMyGiftCards(),
    getPointsBalance(),
  ]);

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
        <PointsCard balance={pointsBalance} />
        <p className={styles.subtext}>
          <Link href="/gift-cards">Buy a gift card</Link> · <Link href="/gift-cards/redeem">Redeem a gift card</Link>
        </p>
        <MyGiftCardsList giftCards={giftCards} />
        <SubscriptionsList subscriptions={subscriptions ?? []} />
        <TransactionsList transactions={transactions ?? []} />
      </main>
      <BottomNav active="wallet" />
    </>
  );
}
