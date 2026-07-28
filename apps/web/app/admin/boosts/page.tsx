import { BoostRevenueList } from "@/components/admin/BoostRevenueList";
import { BoostsQueue } from "@/components/admin/BoostsQueue";
import { getActiveBoosts, getBoostRevenue } from "@/lib/api";
import Link from "next/link";
import styles from "../page.module.css";

export default async function AdminBoostsPage() {
  const [active, revenue] = await Promise.all([getActiveBoosts(), getBoostRevenue()]);

  return (
    <>
      <h1 className={styles.heading}>Boosts</h1>

      <h2 className={styles.sectionTitle}>Active / scheduled</h2>
      <BoostsQueue items={active} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Revenue by creator</h2>
      <BoostRevenueList items={revenue} />

      <p className={styles.subtext}>
        Boost pricing moved to <Link href="/admin/settings">Settings</Link>.
      </p>
    </>
  );
}
