import type { FollowerListItem } from "@birq/shared";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./PeopleList.module.css";

// Creator Dashboard's Community > Followers — read-only (no server
// concept of removing a follower exists, or should: unlike a channel
// block, this is the follower's own choice to make, not the creator's).
export function FollowersList({ followers }: { followers: FollowerListItem[] }) {
  if (followers.length === 0) {
    return <p className={styles.empty}>No followers yet.</p>;
  }

  return (
    <div className={styles.list}>
      {followers.map((f) => {
        const avatarUrl = resolveAvatarUrl(f.avatarUrl);
        return (
          <div key={f.userId} className={styles.row}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder} />
            )}
            <div className={styles.info}>
              <p className={styles.name}>{f.displayName}</p>
              <p className={styles.meta}>@{f.username}</p>
            </div>
            <span className={styles.date}>Since {new Date(f.followedAt).toLocaleDateString()}</span>
          </div>
        );
      })}
    </div>
  );
}
