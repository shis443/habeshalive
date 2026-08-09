"use client";

import type { ServedAd } from "@birq/shared";
import styles from "./StreamCard.module.css";
import sponsoredStyles from "./SponsoredStreamCard.module.css";

// Visually similar to StreamCard (same grid slot, same card shape) but
// architecturally and functionally distinct — this is an advertiser-bought
// directory placement, not a real live stream, so it links out to the
// advertiser's click_url rather than a /watch/ page. Keeping the shared
// .card/.thumbnailWrap classes from StreamCard.module.css is intentional:
// the visual family should match so it doesn't look broken in the grid,
// while the "Sponsored" label makes clear it isn't a real stream.
export function SponsoredStreamCard({ ad }: { ad: ServedAd }) {
  function recordClick() {
    fetch(`/api/backend/ads/${ad.impressionId}/click`, { method: "POST" }).catch(() => {});
  }

  return (
    <a
      href={ad.clickUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className={styles.card}
      onClick={recordClick}
    >
      <div className={styles.thumbnailWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element -- advertiser-hosted asset */}
        <img src={ad.assetUrl} alt={ad.advertiserName} className={styles.thumbnail} />
        <span className={sponsoredStyles.sponsoredBadge}>Sponsored</span>
      </div>
      <div className={styles.info}>
        <p className={styles.title}>{ad.advertiserName}</p>
      </div>
    </a>
  );
}
