import { formatSantimAsBirr, type CreatorTier } from "@birq/shared";
import styles from "./TierProgressCard.module.css";

const TIER_LABELS: Record<CreatorTier["tier"], string> = {
  none: "Unranked",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  partner: "Partner",
};

function progressPct(current: number, threshold: number | null): number {
  if (threshold === null || threshold === 0) return 100;
  return Math.min(100, Math.round((current / threshold) * 100));
}

// A creator's own streamer tier — Bronze/Silver/Gold/Partner, computed
// from lifetime watch-hours delivered AND gift volume received (both
// thresholds, not either — see creator-tiers-service.ts). Distinct from
// the viewer-facing gift-spend rank shown in chat/GurshaModal.tsx, a
// different subject entirely (a streamer's own growth, not a viewer's
// generosity).
export function TierProgressCard({ tier }: { tier: CreatorTier }) {
  const watchProgress = progressPct(tier.lifetimeWatchHours, tier.nextTierWatchHoursThreshold);
  const giftProgress = progressPct(tier.lifetimeGiftVolumeSantim, tier.nextTierGiftVolumeSantimThreshold);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={`${styles.badge} ${styles[`badge_${tier.tier}`]}`}>{TIER_LABELS[tier.tier]}</span>
        {tier.isAnchorCreator && <span className={styles.anchorTag}>Anchor Creator</span>}
      </div>

      {tier.nextTier ? (
        <>
          <p className={styles.nextLabel}>Progress toward {TIER_LABELS[tier.nextTier]}</p>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>
              <span>Watch hours</span>
              <span>
                {tier.lifetimeWatchHours.toFixed(1)} / {tier.nextTierWatchHoursThreshold}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${watchProgress}%` }} />
            </div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>
              <span>Gift volume</span>
              <span>
                {formatSantimAsBirr(tier.lifetimeGiftVolumeSantim)} / {formatSantimAsBirr(tier.nextTierGiftVolumeSantimThreshold ?? 0)}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${giftProgress}%` }} />
            </div>
          </div>
          <p className={styles.hint}>Both need to clear the line to reach the next tier.</p>
        </>
      ) : (
        <p className={styles.hint}>You&apos;ve reached the top tier.</p>
      )}
    </div>
  );
}
