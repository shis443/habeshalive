import { KycQueue } from "@/components/admin/KycQueue";
import { getKycSubmissions } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminKycPage() {
  const [pending, approved, rejected] = await Promise.all([
    getKycSubmissions("pending"),
    getKycSubmissions("approved"),
    getKycSubmissions("rejected"),
  ]);

  return (
    <>
      <h1 className={styles.heading}>KYC Review</h1>
      <p className={styles.subtext}>
        Fayda Digital ID / Kebele ID submissions. Enforcing this before payouts is a toggle in Settings —
        off by default.
      </p>

      <h2 className={styles.sectionTitle}>Pending review</h2>
      <KycQueue items={pending} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Approved</h2>
      <KycQueue items={approved} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Rejected</h2>
      <KycQueue items={rejected} />
    </>
  );
}
