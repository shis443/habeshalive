import { StreamTagsPanel } from "@/components/admin/StreamTagsPanel";
import { getStreamTagsAdmin } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminStreamTagsPage() {
  const tags = await getStreamTagsAdmin();

  return (
    <>
      <h1 className={styles.heading}>Stream Tags</h1>
      <p className={styles.subtext}>
        Ban a tag to stop it being attached to new streams (existing links are left alone). Merge folds one tag's
        stream links into another and deletes the source.
      </p>
      <StreamTagsPanel tags={tags} />
    </>
  );
}
