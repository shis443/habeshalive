import type { CreatorProfile } from "@habeshalive/shared";
import { FollowButton } from "./FollowButton";
import { VerifiedIcon } from "./icons";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./ChannelHeader.module.css";

const DEFAULT_AVATAR_URL = resolveAvatarUrl("/avatars/render/00000000-0000-0000-0000-000000000000.svg");

// Offline-path header (watch/[username]/page.tsx) — the live path has its
// own header built into StreamMeta.tsx/ActionRow.tsx, which both need a
// `stream` object (viewer count, boost state, tiers, etc.) that doesn't
// exist once a creator isn't currently live. This is deliberately a
// smaller set of actions than ActionRow — Gursha (scrolls to/clicks the
// live chat's gift button — GurshaActionButton.tsx's own comment) and
// Gift a Sub/Subscribe (need `tiers`, fetched alongside the live stream
// today) don't have anything to act on here. Only Follow, a real,
// fully-functional action independent of live status, is shown; adding
// the others back would mean either fetching tiers separately for a
// profile view that may never need them, or shipping buttons that look
// clickable but don't do anything — worse than not having them.
export function ChannelHeader({ profile, isAuthed }: { profile: CreatorProfile; isAuthed: boolean }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.identity}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveAvatarUrl(profile.avatarUrl) ?? DEFAULT_AVATAR_URL!}
          alt=""
          className={styles.avatar}
        />
        <div>
          <div className={styles.nameRow}>
            <span className={styles.displayName}>{profile.displayName}</span>
            {profile.isVerified && <VerifiedIcon />}
          </div>
          <p className={styles.followerCount}>
            {profile.followerCount.toLocaleString()} follower{profile.followerCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <FollowButton creatorId={profile.id} isAuthed={isAuthed} initialFollowing={profile.isFollowing} />
    </div>
  );
}
