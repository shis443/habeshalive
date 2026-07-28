import { ReportsQueue } from "@/components/admin/ReportsQueue";
import { getReports } from "@/lib/api";
import styles from "../../page.module.css";

export default async function AdminModerationReportsPage() {
  const reports = await getReports();

  return (
    <>
      <h1 className={styles.heading}>Moderation — Reports queue</h1>
      <p className={styles.subtext}>User-submitted reports against a stream, user, or gift message.</p>
      <ReportsQueue items={reports} />
    </>
  );
}
