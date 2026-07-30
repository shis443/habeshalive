import type { SubscriptionTier } from "@habeshalive/shared";
import { EndStreamButton } from "./EndStreamButton";
import { FollowButton } from "./FollowButton";
import { ShareButton } from "./ShareButton";
import styles from "./ActionRow.module.css";
import { TierActionDropdown } from "./TierActionDropdown";

export function ActionRow({
  creatorId,
  isAuthed,
  isFollowing,
  isOwner = false,
  tiers,
}: {
  creatorId: string;
  isAuthed: boolean;
  isFollowing: boolean;
  isOwner?: boolean;
  tiers: SubscriptionTier[];
}) {
  return (
    <div className={styles.row}>
      {isOwner && <EndStreamButton />}
      <FollowButton creatorId={creatorId} isAuthed={isAuthed} initialFollowing={isFollowing} />
      <TierActionDropdown
        label="Gift a Sub"
        tiers={tiers}
        creatorId={creatorId}
        isAuthed={isAuthed}
        mode="gift-sub-stub"
        secondary
      />
      {/* id is a real cross-navigation target, not decorative — GurshaModal's
          "Subscribe instead" link scrolls to and clicks this element's
          button, since the two modals are anchored in separate, unrelated
          parts of the component tree (chat column vs. this action row) with
          no shared modal-navigation state to hook into instead. */}
      <div id="subscribe-action">
        <TierActionDropdown label="Subscribe" tiers={tiers} creatorId={creatorId} isAuthed={isAuthed} mode="subscribe" />
      </div>
      <ShareButton />
    </div>
  );
}
