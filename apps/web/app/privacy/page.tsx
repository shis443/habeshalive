import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function PrivacyPage() {
  return (
    <StaticPageLayout title="Privacy Notice">
      <div className={styles.draftNotice}>
        Draft — current as of July 25, 2026. Not yet reviewed by legal counsel. Don&apos;t treat this
        as a final or binding privacy policy.
      </div>
      <h2>What we collect</h2>
      <p>
        Account info you provide directly (phone number or email, username, display name), your
        streaming/viewing activity (streams, chat messages, gifts sent/received), and standard
        technical data (IP address, device/browser info) needed to operate the service and enforce
        rate limits against abuse.
      </p>
      <h2>How we use it</h2>
      <p>
        To run your account and the platform itself: authentication, processing gifts and payouts,
        content moderation, and basic analytics on how the platform is used. We don&apos;t sell your
        data to third parties.
      </p>
      <h2>Payments</h2>
      <p>
        Wallet top-ups and payouts are processed through Chapa, a third-party Ethiopian payment
        processor — they receive the payment details necessary to process a transaction, subject to
        their own privacy practices.
      </p>
      <h2>Your data</h2>
      <p>
        You can request account deletion by contacting{" "}
        <a href="mailto:privacy@birq.com">privacy@birq.com</a>. Chat messages and
        transaction records tied to other users&apos; activity (e.g. a gift you received) may be
        retained even after account deletion, for the same reason a financial record isn&apos;t
        simply erased on request.
      </p>
    </StaticPageLayout>
  );
}
