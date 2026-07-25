import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function SafetyCenterPage() {
  return (
    <StaticPageLayout title="Safety Center">
      <p>
        This page covers how to report something on HabeshaLive and what actually happens after you
        do. For what&apos;s and isn&apos;t allowed, see{" "}
        <a href="/community-guidelines">Community Guidelines</a>.
      </p>
      <h2>How to report</h2>
      <p>You can report three kinds of things:</p>
      <ul>
        <li><strong>A stream</strong> — from the watch page, if the content itself is the problem.</li>
        <li><strong>A user</strong> — from their profile or chat messages, for harassment or abusive
          behavior.</li>
        <li><strong>A gift message</strong> — the text a viewer attaches to a gift, if that&apos;s
          where the abuse happened.</li>
      </ul>
      <p>
        Every report needs a reason (harassment, hate speech, spam, nudity, or other) and you can add
        details explaining what happened — the more specific, the easier it is for a moderator to act
        on it correctly.
      </p>
      <h2>What happens after you report something</h2>
      <p>
        Your report goes into a queue that HabeshaLive moderators/admins review — not an automated
        system. Each report is marked <strong>actioned</strong> (something was done about it, like
        removing content or banning the account) or <strong>dismissed</strong> (reviewed, no
        violation found). You won&apos;t see a live status update on an individual report right now,
        but it is genuinely reviewed, not just logged and ignored.
      </p>
      <h2>If your own account gets banned</h2>
      <p>
        A banned account can still do exactly one thing: submit an appeal explaining why the ban
        should be reconsidered. An admin reviews it and approves or denies the appeal. This is a real
        review, not a formality — explain the actual situation.
      </p>
      <h2>Immediate danger</h2>
      <p>
        If a situation involves immediate danger to someone&apos;s safety, contact your local
        emergency services first — reporting on HabeshaLive is for platform enforcement, not
        emergency response.
      </p>
    </StaticPageLayout>
  );
}
