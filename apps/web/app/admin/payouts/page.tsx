import { PayoutBatchBuilder } from "@/components/admin/PayoutBatchBuilder";
import { PayoutBatchList } from "@/components/admin/PayoutBatchList";
import { PayoutHistoryFilters } from "@/components/admin/PayoutHistoryFilters";
import { PayoutHistoryList } from "@/components/admin/PayoutHistoryList";
import { PayoutInstrumentQueue } from "@/components/admin/PayoutInstrumentQueue";
import { PayoutsQueue } from "@/components/admin/PayoutsQueue";
import { TaxProfileQueue } from "@/components/admin/TaxProfileQueue";
import {
  getPayoutBatches,
  getPayoutHistory,
  getPendingPayouts,
  getPendingPayoutInstruments,
  getPendingTaxProfiles,
} from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; creator?: string }>;
}) {
  const { status, creator } = await searchParams;
  const [pending, history, batches, pendingInstruments, pendingTaxProfiles] = await Promise.all([
    getPendingPayouts(),
    getPayoutHistory({ status, creator }),
    getPayoutBatches(),
    getPendingPayoutInstruments(),
    getPendingTaxProfiles(),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Payouts</h1>

      <h2 className={styles.sectionTitle}>Awaiting review</h2>
      <PayoutsQueue items={pending} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Payout methods awaiting review</h2>
      <PayoutInstrumentQueue items={pendingInstruments} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Tax profiles awaiting review</h2>
      <TaxProfileQueue items={pendingTaxProfiles} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>New batch</h2>
      <PayoutBatchBuilder />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Batches</h2>
      <PayoutBatchList items={batches} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>History</h2>
      <PayoutHistoryFilters />
      <PayoutHistoryList items={history} />
    </>
  );
}
