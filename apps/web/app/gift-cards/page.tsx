import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { GiftCardPurchaseForm } from "@/components/GiftCardPurchaseForm";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser } from "@/lib/api";
import styles from "@/components/StaticPageLayout.module.css";

export default async function GiftCardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/gift-cards");

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Gift Cards</h1>
        <div className={styles.prose}>
          <p>
            Buy Birq wallet credit for someone else — paid from your own Birq wallet balance. The recipient redeems
            it into their own Birq wallet, to spend on gifts, subscriptions, or boosts.
          </p>
        </div>
        <GiftCardPurchaseForm />
      </main>
      <BottomNav />
    </>
  );
}
