import { ModerationPanel } from "@/components/ModerationPanel";
import { getCurrentUser } from "@/lib/api";
import styles from "../page.module.css";

export default async function ModerationPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <>
      <h1 className={styles.heading}>Moderation</h1>
      <p className={styles.subtext}>Channel moderators and blocked viewers for your own channel.</p>
      <ModerationPanel creatorId={user.id} />
    </>
  );
}
