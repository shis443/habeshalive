import Link from "next/link";
import { GoLivePanel } from "@/components/GoLivePanel";
import { getCurrentUser, getLiveStreamByUsername, getStreamKey } from "@/lib/api";
import styles from "../page.module.css";

export default async function StreamManagerPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [streamKey, liveStream] = await Promise.all([getStreamKey(), getLiveStreamByUsername(user.username)]);

  if (!streamKey) {
    return (
      <>
        <h1 className={styles.heading}>Stream Manager</h1>
        <p className={styles.subtext}>
          You don&apos;t have streaming access set up yet.{" "}
          <Link href="/apply-to-stream" className={styles.editAvatarLink}>
            Apply to stream
          </Link>{" "}
          to get a stream key and go live.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.heading}>Stream Manager</h1>
      <p className={styles.subtext}>Title, category, thumbnail, tags, your stream key, and co-streaming.</p>
      <GoLivePanel
        rtmpUrl={streamKey.rtmpUrl}
        streamKey={streamKey.streamKey}
        displayName={user.displayName}
        initialIsLive={!!liveStream}
      />
    </>
  );
}
