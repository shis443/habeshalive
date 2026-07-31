import { AdLeadForm } from "@/components/AdLeadForm";
import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function AdvertisersPage() {
  return (
    <StaticPageLayout title="Advertise on Birq">
      <p>
        Reach live audiences across Ethiopia&apos;s creator community — Music, Gaming, Traditional, and Just
        Chatting streams, in Amharic, Afaan Oromo, Tigrinya, and English.
      </p>
      <h2>Formats</h2>
      <ul>
        <li><strong>Pre-roll</strong> — a short video ad before a viewer's stream starts playing.</li>
        <li><strong>Mid-roll</strong> — a video ad during a live stream, creator-triggered.</li>
        <li><strong>Display banner</strong> — a static/animated banner below the player and on Explore.</li>
        <li><strong>Sponsored stream card</strong> — a promoted placement in the live directory.</li>
        <li><strong>Overlay banner</strong> — a small banner over the video during a stream.</li>
      </ul>
      <h2>Targeting</h2>
      <p>
        Campaigns can target by category, language, and minimum concurrent viewers. Every campaign is billed on a
        CPM (cost per 1,000 impressions) basis, with a fixed budget and a real-time spend cap — a campaign never
        overspends its budget.
      </p>
      <h2>Get in touch</h2>
      <AdLeadForm />
    </StaticPageLayout>
  );
}
