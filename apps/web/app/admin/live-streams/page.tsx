import { LiveStreamsList } from "@/components/admin/LiveStreamsList";
import { StreamArchiveList } from "@/components/admin/StreamArchiveList";
import { getAdminLiveStreams, getStreamArchive } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminLiveStreamsPage({
  searchParams,
}: {
  searchParams: Promise<{ creator?: string }>;
}) {
  const { creator } = await searchParams;
  const [streams, archive] = await Promise.all([getAdminLiveStreams(), getStreamArchive(creator)]);

  return (
    <>
      <h1 className={styles.heading}>Live Streams</h1>
      <p className={styles.subtext}>Real-time operational view, separate from the moderation queue&apos;s reactive flow. Refreshes every 10s.</p>
      <LiveStreamsList initialStreams={streams} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Archive</h2>
      <form action="/admin/live-streams" className={styles.filterForm}>
        <input
          type="text"
          name="creator"
          className={styles.filterInput}
          placeholder="Filter by creator username"
          defaultValue={creator ?? ""}
        />
      </form>
      <StreamArchiveList items={archive} />
    </>
  );
}
