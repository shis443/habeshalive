import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function AnchorCreatorProgramPage() {
  return (
    <StaticPageLayout title="Anchor Creator Program">
      <p>
        Anchor creators are the small group of streamers HabeshaLive builds around directly —
        established hosts (music, gaming, just-chatting) who bring an existing audience with them and
        stream regularly enough to anchor a category. This is how the platform grows early: real
        creators pulling their communities over, not ads.
      </p>
      <h2>What being an anchor creator means</h2>
      <ul>
        <li>A boosted revenue share on gifts, above the platform&apos;s standard split — up to 90%
          to the creator on gifts, subject to change as the program develops.</li>
        <li>Direct support from the HabeshaLive team for stream setup, OBS configuration, and payout
          questions — not a ticket queue.</li>
        <li>Priority placement on the Explore page while you&apos;re actively streaming.</li>
        <li>Input into what gets built next — anchor creators are the first people we ask before
          shipping a new feature that affects streaming or payouts.</li>
      </ul>
      <h2>Who this is for</h2>
      <p>
        Creators who already stream somewhere (or are ready to commit to a regular schedule) and want
        to build specifically for an Ethiopian/Amharic-speaking audience. You don&apos;t need an
        existing HabeshaLive following to apply — you need an existing audience somewhere and a real
        streaming habit.
      </p>
      <h2>How to apply</h2>
      <p>
        Create a HabeshaLive account, stream at least a few times so we can see your setup and
        content, then reach out at{" "}
        <a href="mailto:creators@habeshalive.com">creators@habeshalive.com</a> with links to your
        existing channel(s) and your streaming schedule. We follow up directly — there&apos;s no
        automated approval flow for this yet.
      </p>
      <p>
        <em>
          The revenue-share figure above is an illustrative starting point, not a finalized term —
          actual terms are confirmed directly with each anchor creator.
        </em>
      </p>
    </StaticPageLayout>
  );
}
