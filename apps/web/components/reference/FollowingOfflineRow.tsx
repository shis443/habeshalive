import Link from "next/link";
import styles from "./FollowingOfflineRow.module.css";

export function FollowingOfflineRow({
  id,
  username,
  displayName,
  avatarUrl,
  newContentCount,
}: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  newContentCount: number;
}) {
  return (
    <Link href={`/watch/${username}`} className={styles.row}>
      <img src={avatarUrl ?? "/avatar-fallback.png"} alt="" className={styles.avatar} />
      <div className={styles.info}>
        <div className={styles.name}>{displayName}</div>
        {newContentCount > 0 && <div className={styles.count}>{`${newContentCount} new video${newContentCount === 1 ? "" : "s"}`}</div>}
      </div>
      {newContentCount > 0 && <div className={styles.trailing}>›</div>}
    </Link>
  );
}

export default FollowingOfflineRow;
