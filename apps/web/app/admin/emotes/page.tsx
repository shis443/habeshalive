import { EmoteQueue } from "@/components/admin/EmoteQueue";
import { getEmoteSubmissions } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminEmotesPage() {
  const [pending, approved, rejected] = await Promise.all([
    getEmoteSubmissions("pending"),
    getEmoteSubmissions("approved"),
    getEmoteSubmissions("rejected"),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Emote Review</h1>
      <p className={styles.subtext}>
        Custom emotes Birq Plus subscribers contributed to the platform-wide catalog. An approved emote is usable
        by every chatter, everywhere — review for anything offensive or off-brand before it goes live.
      </p>

      <h2 className={styles.sectionTitle}>Pending review</h2>
      <EmoteQueue items={pending} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Approved</h2>
      <EmoteQueue items={approved} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Rejected</h2>
      <EmoteQueue items={rejected} />
    </>
  );
}
