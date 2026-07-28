import { PayoutHistoryFilters } from "@/components/admin/PayoutHistoryFilters";
import { PayoutHistoryList } from "@/components/admin/PayoutHistoryList";
import { PayoutsQueue } from "@/components/admin/PayoutsQueue";
import { getPayoutHistory, getPendingPayouts } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; creator?: string }>;
}) {
  const { status, creator } = await searchParams;
  const [pending, history] = await Promise.all([getPendingPayouts(), getPayoutHistory({ status, creator })]);

  return (
    <>
      <h1 className={styles.heading}>Payouts</h1>

      <h2 className={styles.sectionTitle}>Awaiting review</h2>
      <PayoutsQueue items={pending} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>History</h2>
      <PayoutHistoryFilters />
      <PayoutHistoryList items={history} />
    </>
  );
}
