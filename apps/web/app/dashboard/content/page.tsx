import Link from "next/link";
import { ClipCreatorPanel } from "@/components/ClipCreatorPanel";
import { VodManager } from "@/components/VodManager";
import { getMyVods, getStreamKey } from "@/lib/api";
import styles from "../page.module.css";

export default async function ContentPage() {
  const streamKey = await getStreamKey();

  if (!streamKey) {
    return (
      <>
        <h1 className={styles.heading}>Content</h1>
        <p className={styles.subtext}>
          Streaming access is required before you have any VODs.{" "}
          <Link href="/apply-to-stream" className={styles.editAvatarLink}>
            Apply to stream
          </Link>
        </p>
      </>
    );
  }

  const myVods = await getMyVods();

  return (
    <>
      <h1 className={styles.heading}>Content</h1>
      <p className={styles.subtext}>Manage your past broadcasts and create 9:16 clips from them.</p>

      <h2 className={styles.sectionTitle}>Your VODs</h2>
      <VodManager vods={myVods} />

      {myVods.length > 0 && (
        <>
          <h2 className={styles.sectionTitle} style={{ marginTop: "var(--space-4)" }}>
            Clips
          </h2>
          <ClipCreatorPanel vods={myVods} />
        </>
      )}
    </>
  );
}
