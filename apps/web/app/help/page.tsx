import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function HelpPage() {
  return (
    <StaticPageLayout title="Help">
      <h2>Getting started</h2>
      <p>
        Sign up with a phone number or email, pick a username, and you can watch immediately.
        To stream, apply from <a href="/apply-to-stream">Apply to Stream</a>{" "}
        — approval isn&apos;t automatic while Birq is in its early launch window (see{" "}
        <a href="/anchor-creator-program">Anchor Creator Program</a> for the fast-track path).
      </p>
      <h2>Going live</h2>
      <p>
        Once approved, your stream key and go-live controls live on your{" "}
        <a href="/dashboard">Dashboard</a>. You can stream from OBS (or any RTMP/WHIP-compatible
        software) using your stream key, or go live directly from your browser camera — no
        extra software required. Set a title, category, and language before you start; tags are
        optional and help viewers find your stream by topic.
      </p>
      <h2>Gursha (sending support)</h2>
      <p>
        Gursha is how viewers support creators directly during a stream — pick a theme, choose a
        quantity, and send it publicly or anonymously. It comes out of your wallet balance, so
        top up first from <a href="/wallet">Wallet</a>. Gifts to a creator you&apos;ve sent to
        before also count toward that creator&apos;s gifter badges.
      </p>
      <h2>Gift cards</h2>
      <p>
        <a href="/gift-cards">Gift cards</a>{" "}
        let you send wallet balance to someone else, even if they don&apos;t have a Birq account
        yet — they redeem the code at{" "}
        <a href="/gift-cards/redeem">Redeem a gift card</a>.
      </p>
      <h2>Subscriptions</h2>
      <p>
        Subscribing to a creator is a recurring monthly show of support with its own perks (ad-free
        viewing on that creator&apos;s stream, a subscriber badge in chat). Manage an active
        subscription from the creator&apos;s channel page.
      </p>
      <h2>Problems and reports</h2>
      <p>
        For anything involving abuse, harassment, or content that shouldn&apos;t be on the
        platform, see the <a href="/safety-center">Safety Center</a>{" "}
        — it covers how to report a stream, user, or message, and what happens after you do.
      </p>
      <h2>Still stuck?</h2>
      <p>
        Email <a href="mailto:support@birq.com">support@birq.com</a>{" "}
        with as much detail as you can (what you were doing, what you expected, what happened
        instead) — there&apos;s no live chat support yet, so a specific report gets resolved
        faster than a general one.
      </p>
    </StaticPageLayout>
  );
}
