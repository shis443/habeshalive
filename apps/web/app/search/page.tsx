import { BottomNav } from "@/components/BottomNav";
import { CreatorCard } from "@/components/CreatorCard";
import { StreamCard } from "@/components/StreamCard";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, search } from "@/lib/api";
import styles from "./page.module.css";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [user, results] = await Promise.all([getCurrentUser(), search(q ?? "")]);

  const hasQuery = !!q?.trim();
  const hasResults = results.streams.length > 0 || results.creators.length > 0;

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <h1 className={styles.heading}>{hasQuery ? `Results for "${q}"` : "Search"}</h1>

        {!hasQuery && <p className={styles.subtext}>Search for a stream title or creator.</p>}
        {hasQuery && !hasResults && <p className={styles.subtext}>No live streams or creators matched.</p>}

        {results.streams.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Live streams</h2>
            <div className={styles.streamGrid}>
              {results.streams.map((stream) => (
                <StreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          </section>
        )}

        {results.creators.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Creators</h2>
            <div className={styles.creatorGrid}>
              {results.creators.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} />
              ))}
            </div>
          </section>
        )}
      </main>
      <BottomNav />
    </>
  );
}
