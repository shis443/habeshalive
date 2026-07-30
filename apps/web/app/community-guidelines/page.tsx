import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function CommunityGuidelinesPage() {
  return (
    <StaticPageLayout title="Community Guidelines">
      <p>
        Birq is built around live chat and gifting between real people. These guidelines cover
        streams, chat messages, and gift messages — anywhere you can post something another person
        will see.
      </p>
      <h2>Not allowed</h2>
      <ul>
        <li>Harassment or targeted abuse of another user or creator.</li>
        <li>Hate speech — content attacking someone for their ethnicity, religion, gender, or
          similar.</li>
        <li>Spam — repeated or automated messages, scam links, unsolicited self-promotion.</li>
        <li>Nudity or sexually explicit content.</li>
        <li>Anything else that&apos;s clearly intended to disrupt a stream or harm another user —
          reported under &quot;Other&quot; if it doesn&apos;t fit the categories above.</li>
      </ul>
      <h2>Chat and gift messages are automatically screened</h2>
      <p>
        Stream titles, chat messages, and gift messages are all checked against a list of flagged
        terms (in English and Amharic) when they&apos;re posted. A match doesn&apos;t auto-delete
        anything — it puts the content into a moderation queue for a real review, so a legitimate
        message with an unlucky word match isn&apos;t silently removed without anyone looking at it.
      </p>
      <h2>Reporting</h2>
      <p>
        Any stream, user, or gift message can be reported directly from the platform. Reports go into
        a queue reviewed by Birq moderators/admins, who mark each one as actioned (something
        was done — content removed, a user banned, etc.) or dismissed. See{" "}
        <a href="/safety-center">Safety Center</a> for exactly how to file one.
      </p>
      <h2>Enforcement</h2>
      <p>
        Depending on severity, enforcement ranges from removing a single message to banning an
        account. A banned user can submit an appeal explaining why the ban should be reconsidered —
        appeals are reviewed by an admin and approved or denied. This isn&apos;t automated; a real
        person reviews every ban appeal.
      </p>
    </StaticPageLayout>
  );
}
