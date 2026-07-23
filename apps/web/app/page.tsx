import { BottomNav } from "@/components/BottomNav";
import { CategoryPills } from "@/components/CategoryPills";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { StreamCard } from "@/components/StreamCard";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getLiveStreams } from "@/lib/api";
import styles from "./page.module.css";

export default async function ExplorePage() {
  const [streams, user] = await Promise.all([getLiveStreams(), getCurrentUser()]);

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={streams} />
      <main className={styles.main}>
        <CategoryPills />
        <h2 className={styles.heading}>Live on HabeshaLive</h2>
        {streams.length === 0 ? (
          <p className={styles.empty}>No one is live right now. Check back soon.</p>
        ) : (
          <div className={styles.grid}>
            {streams.map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        )}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
