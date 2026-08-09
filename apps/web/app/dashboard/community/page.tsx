import Link from "next/link";
import { getChannelsIModerate, getMyFollowers } from "@/lib/api";
import styles from "../page.module.css";

export default async function CommunityPage() {
  const [followers, moderatedChannels] = await Promise.all([getMyFollowers(), getChannelsIModerate()]);

  return (
    <>
      <h1 className={styles.heading}>Community</h1>
      <p className={styles.subtext}>Your followers and any channels that have made you a moderator.</p>

      <div className={styles.statGrid}>
        <Link href="/dashboard/community/followers" className={styles.checklistItem}>
          <span>Followers</span>
          <span className={styles.checklistLink}>{followers.length}</span>
        </Link>
        <Link href="/dashboard/community/my-roles" className={styles.checklistItem}>
          <span>My Assigned Roles</span>
          <span className={styles.checklistLink}>{moderatedChannels.length}</span>
        </Link>
      </div>
    </>
  );
}
