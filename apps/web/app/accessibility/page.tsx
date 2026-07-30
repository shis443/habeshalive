import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function AccessibilityPage() {
  return (
    <StaticPageLayout title="Accessibility Statement">
      <div className={styles.draftNotice}>
        Draft — current as of July 30, 2026. Describes intent and current state, not a certified
        conformance claim.
      </div>
      <h2>Our commitment</h2>
      <p>
        Birq aims to be usable by as many people as possible, including people using screen readers,
        keyboard-only navigation, or browser zoom/high-contrast settings. This is an ongoing effort,
        not a finished state — this page will be updated as work continues.
      </p>
      <h2>What's in place today</h2>
      <ul>
        <li>Keyboard navigation for primary flows (browsing, watching, chat, account menus).</li>
        <li>Visible focus indicators on interactive elements.</li>
        <li>Text alternatives for icon-only buttons via ARIA labels.</li>
        <li>Colour choices checked against standard contrast guidelines in the core design system.</li>
      </ul>
      <h2>Known gaps</h2>
      <p>
        Some newer or in-progress features may not yet fully meet the same bar — live video playback
        controls, some data-heavy admin tooling, and third-party embedded content (e.g. payment
        checkout) are only as accessible as their own upstream implementations allow.
      </p>
      <h2>Feedback</h2>
      <p>
        If something on Birq is difficult to use with assistive technology, tell us specifically what
        broke and where: <a href="mailto:accessibility@birq.com">accessibility@birq.com</a>.
      </p>
    </StaticPageLayout>
  );
}
