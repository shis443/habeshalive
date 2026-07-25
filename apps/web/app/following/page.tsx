import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { CreatorCard } from "@/components/CreatorCard";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getFollowedCreators } from "@/lib/api";
import styles from "./page.module.css";

export default async function FollowingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/following");

  const creators = (await getFollowedCreators()) ?? [];
  const liveCount = creators.filter((c) => c.isLive).length;

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
            </p>
            <div className={styles.creatorGrid}>
              {creators.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} muteWhenOffline />
              ))}
            </div>
          </>
        )}
      </main>
      <BottomNav active="following" />
    </>
  );
}
