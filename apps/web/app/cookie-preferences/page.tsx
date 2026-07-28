import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function CookiePreferencesPage() {
  return (
    <StaticPageLayout title="Cookies & Ads Choices">
      <div className={styles.draftNotice}>
        This lists what Birq actually sets today, not a generic template — updated if that ever
        changes.
      </div>
      <h2>What we use</h2>
      <p>
        A single cookie: <code>session</code>, which stores your login session token. It&apos;s
        required for the site to know you&apos;re logged in — there&apos;s no way to opt out of it
        without logging out.
      </p>
      <h2>Ads</h2>
      <p>
        Birq doesn&apos;t run ads or ad tracking anywhere on the platform — the product runs on
        birr gifting and subscriptions instead. There are no ad-targeting or third-party ad cookies
        to choose between.
      </p>
      <h2>Analytics</h2>
      <p>
        We don&apos;t currently set any analytics or tracking cookies. If that changes, this page
        will list them here along with a real way to opt out — not before.
      </p>
    </StaticPageLayout>
  );
}
