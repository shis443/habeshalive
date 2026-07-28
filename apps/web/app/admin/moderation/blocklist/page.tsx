import { BlocklistManager } from "@/components/admin/BlocklistManager";
import { getBlocklistTerms } from "@/lib/api";
import styles from "../../page.module.css";

export default async function AdminModerationBlocklistPage() {
  const terms = await getBlocklistTerms();

  return (
    <>
      <h1 className={styles.heading}>Moderation — Blocklist</h1>
      <p className={styles.subtext}>
        Terms here auto-flag a stream title or gift message into Flagged content for review — they don&apos;t block
        or delete anything themselves.
      </p>
      <BlocklistManager items={terms} />
    </>
  );
}
