import { AnnouncementsPanel } from "@/components/admin/AnnouncementsPanel";
import { getAnnouncementsAdmin } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminAnnouncementsPage() {
  const announcements = await getAnnouncementsAdmin();

  return (
    <>
      <h1 className={styles.heading}>Announcements</h1>
      <p className={styles.subtext}>
        Platform-wide banner shown to every visitor (D.2) — dismissing one is per-browser and
        doesn&apos;t affect anyone else. Creator-level announcements aren&apos;t built yet.
      </p>
      <AnnouncementsPanel items={announcements} />
    </>
  );
}
