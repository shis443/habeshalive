import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function AdChoicesPage() {
  return (
    <StaticPageLayout title="Ad Choices">
      <h2>What ad targeting Birq uses</h2>
      <p>
        Advertisers on Birq can target campaigns by the stream&apos;s category, language, and current viewer count.
        Birq does not sell individual users&apos; personal data or browsing history to advertisers, and does not
        use cross-site tracking to build ad profiles.
      </p>
      <h2>What data is collected for ad delivery</h2>
      <ul>
        <li>Which stream an ad was shown on, and roughly when (to bill the advertiser and cap how often the same
          person sees the same ad).</li>
        <li>Whether you clicked an ad (to report performance to the advertiser).</li>
        <li>If you&apos;re logged in, your account is used to check whether you&apos;re a subscriber to the
          creator you&apos;re watching — subscribers don&apos;t see ads on that creator&apos;s stream.</li>
      </ul>
      <h2>Your choices</h2>
      <p>
        Subscribing to a creator removes ads on their stream. There is currently no separate global "opt out of
        ads" setting — ads on Birq fund creator payouts directly (see the revenue share on the{" "}
        <a href="/advertisers">Advertisers</a> page), so turning them off platform-wide isn&apos;t offered as a
        toggle today.
      </p>
      <p>
        Questions about how your data is used for ads: <a href="mailto:privacy@birq.com">privacy@birq.com</a>. See
        also the full <a href="/privacy">Privacy Notice</a>.
      </p>
    </StaticPageLayout>
  );
}
