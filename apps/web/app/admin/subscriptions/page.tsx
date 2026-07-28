import { SubscriptionsAdminList } from "@/components/admin/SubscriptionsAdminList";
import { getAdminSubscriptions } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminSubscriptionsPage() {
  const [active, atRisk] = await Promise.all([getAdminSubscriptions(false), getAdminSubscriptions(true)]);

  return (
    <>
      <h1 className={styles.heading}>Subscriptions</h1>

      <h2 className={styles.sectionTitle}>At risk (payment failed, grace period)</h2>
      <SubscriptionsAdminList items={atRisk} atRisk />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Active</h2>
      <SubscriptionsAdminList items={active} atRisk={false} />
    </>
  );
}
