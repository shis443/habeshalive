import { BoostRevenueList } from "@/components/admin/BoostRevenueList";
import { BoostsQueue } from "@/components/admin/BoostsQueue";
import { PlatformConfigForm } from "@/components/admin/PlatformConfigForm";
import { getActiveBoosts, getBoostRevenue, getPlatformConfigData } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminBoostsPage() {
  const [active, revenue, config] = await Promise.all([
    getActiveBoosts(),
    getBoostRevenue(),
    getPlatformConfigData(),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Boosts</h1>

      <h2 className={styles.sectionTitle}>Active / scheduled</h2>
      <BoostsQueue items={active} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Revenue by creator</h2>
      <BoostRevenueList items={revenue} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Pricing</h2>
      <PlatformConfigForm config={config} />
    </>
  );
}
