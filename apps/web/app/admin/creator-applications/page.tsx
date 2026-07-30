import { CreatorApplicationsQueue } from "@/components/admin/CreatorApplicationsQueue";
import { getCreatorApplicationCapStatus, getCreatorApplications } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminCreatorApplicationsPage() {
  const [pending, approved, rejected, capStatus] = await Promise.all([
    getCreatorApplications("pending"),
    getCreatorApplications("approved"),
    getCreatorApplications("rejected"),
    getCreatorApplicationCapStatus(),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Creator Applications</h1>
      <p className={styles.subtext}>
        {capStatus ? `${capStatus.approvedCount} of ${capStatus.cap} approved-creator spots filled.` : ""}{" "}
        Cap is adjustable in Settings.
      </p>

      <h2 className={styles.sectionTitle}>Pending review</h2>
      <CreatorApplicationsQueue items={pending} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Approved</h2>
      <CreatorApplicationsQueue items={approved} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Rejected</h2>
      <CreatorApplicationsQueue items={rejected} />
    </>
  );
}
