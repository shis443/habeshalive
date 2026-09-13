import { AdminGiftTypesList } from "@/components/admin/AdminGiftTypesList";
import { getAdminGiftTypes } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminGiftsPage() {
  const giftTypes = await getAdminGiftTypes();

  return (
    <>
      <h1 className={styles.heading}>Gift Catalog</h1>
      <p className={styles.subtext}>
        Price, availability window and region apply to every future send. Creator share here is a planning
        reference only — every send actually splits by the creator&apos;s own negotiated rate, set on the
        Creators page.
      </p>
      <AdminGiftTypesList items={giftTypes} />
    </>
  );
}
