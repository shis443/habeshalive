import { ModerationQueue } from "@/components/admin/ModerationQueue";
import { getModerationQueue } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminModerationFlaggedPage() {
  const flags = await getModerationQueue();

  return (
    <>
      <h1 className={styles.heading}>Moderation — Flagged content</h1>
      <p className={styles.subtext}>Stream titles and gift messages the blocklist scan caught automatically.</p>
      <ModerationQueue items={flags} />
    </>
  );
}
