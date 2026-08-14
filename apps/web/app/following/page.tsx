import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { CreatorCard } from "@/components/CreatorCard";
import LiveRowCompact from "@/components/reference/LiveRowCompact";
import FollowingOfflineRow from "@/components/reference/FollowingOfflineRow";
import { FollowingSeenBeacon } from "@/components/FollowingSeenBeacon";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getFollowedCreators } from "@/lib/api";
import styles from "./page.module.css";

export default async function FollowingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/following");

  const creators = (await getFollowedCreators()) ?? [];
  const liveCount = creators.filter((c) => c.isLive).length;
  const totalNewContent = creators.reduce((sum, creator) => {
    const count =
      typeof creator.newContentCount === "number"
        ? creator.newContentCount
        : (creator as { hasNewContent?: boolean }).hasNewContent
          ? 1
          : 0;
    return sum + count;
  }, 0);

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Following</h1>

        {creators.length === 0 ? (
          <p className={styles.subtext}>
            You&apos;re not following anyone yet — creators you follow show up here, live ones first.
          </p>
        ) : (
          <>
            <p className={styles.subtext}>
              {liveCount > 0 ? `${liveCount} live now` : "No one you follow is live right now"}
              {totalNewContent > 0 ? ` · ${totalNewContent} new video${totalNewContent === 1 ? "" : "s"}` : ""}
            </p>
            <section>
              <h2 className={styles.sectionLabel}>LIVE CHANNELS</h2>
              <div className={styles.list}>
                {creators
                  .filter((c) => c.isLive && c.currentStream)
                  .map((c) => (
                    <LiveRowCompact key={c.id} stream={c.currentStream!} />
                  ))}
              </div>
            </section>

            <section>
              <h2 className={styles.sectionLabel}>OFFLINE CHANNELS</h2>
              <div className={styles.list}>
                {creators
                  .filter((c) => !c.isLive)
                  .map((c) => (
                    <FollowingOfflineRow
                      key={c.id}
                      id={c.id}
                      username={c.username}
                      displayName={c.displayName}
                      avatarUrl={c.avatarUrl}
                      newContentCount={c.newContentCount}
                    />
                  ))}
              </div>
            </section>
          </>
        )}
      </main>
      <BottomNav active="following" />
      <FollowingSeenBeacon />
    </>
  );
}
