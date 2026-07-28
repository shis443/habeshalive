import { AppealsQueue } from "@/components/admin/AppealsQueue";
import { getAppeals } from "@/lib/api";
import styles from "../../page.module.css";

export default async function AdminModerationAppealsPage() {
  const appeals = await getAppeals();

  return (
    <>
      <h1 className={styles.heading}>Moderation — Appeals queue</h1>
      <p className={styles.subtext}>Users contesting a ban. Approving unbans them automatically.</p>
      <AppealsQueue items={appeals} />
    </>
  );
}
