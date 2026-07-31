"use client";

import type { ServedAd } from "@habeshalive/shared";
import styles from "./AdDisplayBanner.module.css";

function recordClick(impressionId: string) {
  // Fire-and-forget, same "don't block the user's actual action on an
  // analytics write" posture as the rest of this codebase's best-effort
  // background calls (see chat/service.ts's publishToCentrifugo).
  fetch(`/api/backend/ads/${impressionId}/click`, { method: "POST" }).catch(() => {});
}

export function AdDisplayBanner({ ad }: { ad: ServedAd | null }) {
  if (!ad) return null;

  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- advertiser-hosted or data: URI, not an optimizable local asset */}
      <img src={ad.assetUrl} alt={ad.advertiserName} className={styles.image} />
      <span className={styles.sponsoredLabel}>Sponsored · {ad.advertiserName}</span>
    </>
  );

  if (ad.clickUrl) {
    return (
      <a
        href={ad.clickUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={styles.wrap}
        onClick={() => recordClick(ad.impressionId)}
      >
        {content}
      </a>
    );
  }

  return <div className={styles.wrap}>{content}</div>;
}
