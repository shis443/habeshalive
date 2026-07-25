import { BottomNav } from "@/components/BottomNav";
import { ExploreGrid } from "@/components/ExploreGrid";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
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
        <ExploreGrid streams={streams} />
      </main>
      <BottomNav active="explore" />
    </>
  );
}
