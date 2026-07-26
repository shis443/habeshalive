import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function AboutPage() {
  return (
    <StaticPageLayout title="About Birq">
      <p>
        Birq is a live-streaming platform built for Ethiopian creators — musicians, gamers, and
        just-chatting hosts streaming to an audience that shares their language and culture.
      </p>
      <h2>How creators actually get paid</h2>
      <p>
        Birq doesn&apos;t run on advertising. Viewers support creators directly by gifting birr
        during a stream — the gift goes straight into the platform&apos;s ledger, split between the
        creator and the platform, and lands in the creator&apos;s wallet in real time. No ad-revenue
        thresholds, no waiting on brand deals to get paid for the work you&apos;re already doing.
      </p>
      <h2>Why this matters</h2>
      <p>
        A lot of streaming platforms treat Ethiopian (and broader East African) creators as an
        afterthought — wrong language defaults, payout methods that don&apos;t reach local banks, and
        an audience that has to go looking for content in their own language instead of finding it
        by default. Birq starts from the other direction: built for this audience and these
        creators first.
      </p>
    </StaticPageLayout>
  );
}
