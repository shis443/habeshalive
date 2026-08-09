import type { ModeratedChannel } from "@habeshalive/shared";
import Link from "next/link";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./PeopleList.module.css";

// Creator Dashboard's Community > My Assigned Roles — channels that
// granted the current user moderator status (channel_moderator_grants,
// see moderation/channel-mods-service.ts's listChannelsIModerate). The
// grant/revoke action itself stays owner-only on the granting channel, so
// this page is read-only — a moderator can see where they've been
// granted access but can't self-revoke or grant others from here.
export function MyAssignedRoles({ channels }: { channels: ModeratedChannel[] }) {
  if (channels.length === 0) {
    return <p className={styles.empty}>You haven&apos;t been made a moderator on any other channel yet.</p>;
  }

  return (
    <div className={styles.list}>
      {channels.map((c) => {
        const avatarUrl = resolveAvatarUrl(c.creatorAvatarUrl);
        return (
          <Link key={c.creatorId} href={`/watch/${c.creatorUsername}`} className={styles.row}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder} />
            )}
            <div className={styles.info}>
              <p className={styles.name}>{c.creatorDisplayName}</p>
              <p className={styles.meta}>@{c.creatorUsername}</p>
            </div>
            <span className={styles.date}>Since {new Date(c.grantedAt).toLocaleDateString()}</span>
          </Link>
        );
      })}
    </div>
  );
}
