import { PrivacyCenterControls } from "@/components/PrivacyCenterControls";
import { StaticPageLayout } from "@/components/StaticPageLayout";
import { getCurrentUser } from "@/lib/api";

export default async function PrivacyCenterPage() {
  const user = await getCurrentUser();

  return (
    <StaticPageLayout title="Privacy Center">
      <p>
        This is where your actual data controls on Birq live, separate from the{" "}
        <a href="/privacy">Privacy Notice</a> (which explains what we collect and why).
      </p>
      <h2>Content controls</h2>
      <PrivacyCenterControls isAuthed={!!user} />
      <h2>Ad preferences</h2>
      <p>
        See <a href="/ad-choices">Ad Choices</a>{" "}
        for how house ads are targeted and how to opt out of category-based targeting. Manage
        cookie-level tracking preferences at{" "}
        <a href="/cookie-preferences">Cookie Notice</a>.
      </p>
      <h2>Your account data</h2>
      <p>
        To request a copy of your data or delete your account, email{" "}
        <a href="mailto:privacy@birq.com">privacy@birq.com</a>. Chat messages and transaction
        records tied to other users&apos; activity (e.g. a gift you received) may be retained even
        after account deletion, for the same reason a financial record isn&apos;t simply erased on
        request.
      </p>
    </StaticPageLayout>
  );
}
