import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function TermsPage() {
  return (
    <StaticPageLayout title="Terms of Service">
      <div className={styles.draftNotice}>
        Draft — current as of July 25, 2026. Not yet reviewed by legal counsel. Don&apos;t treat this
        as a final or binding agreement.
      </div>
      <h2>Your account</h2>
      <p>
        You&apos;re responsible for activity on your account. Accounts are personal — don&apos;t share
        login credentials or transfer an account to someone else.
      </p>
      <h2>Content and conduct</h2>
      <p>
        Streams, chat, and gift messages must follow the{" "}
        <a href="/community-guidelines">Community Guidelines</a>. We can remove content or suspend
        accounts that violate them, per the process described in the{" "}
        <a href="/safety-center">Safety Center</a>.
      </p>
      <h2>Gifting and payouts</h2>
      <p>
        Gifts are a direct transfer of value from viewer to creator (minus the platform&apos;s share)
        and, once sent, are not refundable except where required by law or in cases of confirmed
        platform error. Payouts are processed through Chapa and subject to their own processing
        times and terms.
      </p>
      <h2>Changes</h2>
      <p>
        These terms may change as the platform develops. Continued use after a change means you
        accept the updated terms.
      </p>
      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:legal@birq.com">legal@birq.com</a>.
      </p>
    </StaticPageLayout>
  );
}
