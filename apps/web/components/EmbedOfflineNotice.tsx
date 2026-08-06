"use client";

import { useTranslations } from "next-intl";
import styles from "./EmbedOfflineNotice.module.css";

// Same reasoning as OfflineNotice.tsx (split out of the embed page's Server
// Component so useTranslations has a client subtree to run in) — kept as
// its own component/message key rather than sharing OfflineNotice, since
// the embed page's copy is deliberately shorter (no "check back later"
// line, single trailing period) — a real, distinct string, not a
// duplicate of the watch page's.
export function EmbedOfflineNotice({ username }: { username: string }) {
  const t = useTranslations("embed");
  return (
    <div className={styles.offline}>
      <p>{t("offlineTitle", { username })}</p>
    </div>
  );
}
