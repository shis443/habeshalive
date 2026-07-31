import { GiftCardsPanel } from "@/components/admin/GiftCardsPanel";
import { getGiftCardsAdmin, getSuspiciousGiftCardPurchasers } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminGiftCardsPage() {
  const [items, suspicious] = await Promise.all([getGiftCardsAdmin(), getSuspiciousGiftCardPurchasers()]);

  return (
    <>
      <h1 className={styles.heading}>Gift Cards</h1>
      <GiftCardsPanel items={items} suspicious={suspicious} />
    </>
  );
}
