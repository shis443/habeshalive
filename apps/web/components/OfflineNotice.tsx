"use client";

import { useTranslations } from "next-intl";
import styles from "./OfflineNotice.module.css";

// A small client component split out of watch/[username]/page.tsx (a
// Server Component) purely so this one piece of text can use useTranslations
// — see components/IntlProvider.tsx's own comment for why locale is a
// client-only concern in this app: a Server Component always renders with
// the "en" stub from i18n/request.ts, but anything mounted underneath the
// root layout's <IntlProvider> (which wraps the whole app, including this
// page's subtree) picks up the real active locale once it hydrates, same
// as TopNav/BottomNav already do.
export function OfflineNotice({ username }: { username: string }) {
  const t = useTranslations("watch");
  return (
    <div className={styles.offlineWrap}>
      <h1 className={styles.offlineTitle}>{t("offlineTitle", { username })}</h1>
      <p className={styles.offlineText}>{t("offlineText")}</p>
    </div>
  );
}
