import { ModerationActionHistory } from "@/components/admin/ModerationActionHistory";
import { getModerationActions } from "@/lib/api";
import styles from "../../page.module.css";

export default async function AdminModerationHistoryPage() {
  const actions = await getModerationActions();

  return (
    <>
      <h1 className={styles.heading}>Moderation — Action history</h1>
      <p className={styles.subtext}>Every ban, unban, timeout, and message deletion, with who did it and why.</p>
      <ModerationActionHistory items={actions} />
    </>
  );
}
