import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function SecurityPage() {
  return (
    <StaticPageLayout title="Security">
      <div className={styles.draftNotice}>
        Draft — current as of July 30, 2026. Not yet reviewed by legal counsel.
      </div>
      <h2>Reporting a vulnerability</h2>
      <p>
        If you've found a security issue in Birq — an authentication bypass, a way to access another
        user's data or wallet, an injection vulnerability, or anything similar — report it to{" "}
        <a href="mailto:security@birq.com">security@birq.com</a> before disclosing it anywhere else.
        Include enough detail to reproduce it: the affected page/endpoint, steps taken, and what you
        observed versus what you expected.
      </p>
      <h2>Safe harbor</h2>
      <p>
        Good-faith security research conducted to identify and report a vulnerability, without
        accessing, modifying, or exfiltrating other users' data beyond what's needed to demonstrate the
        issue, without degrading service for other users, and reported to us promptly and privately,
        will not result in legal action from Birq.
      </p>
      <h2>Out of scope</h2>
      <ul>
        <li>Social engineering of Birq staff or users.</li>
        <li>Physical access attacks against Birq infrastructure.</li>
        <li>Denial-of-service testing against production systems.</li>
        <li>Automated scanning that generates significant traffic without prior coordination.</li>
      </ul>
      <h2>What to expect</h2>
      <p>
        We'll acknowledge a real report and work on a fix. This program doesn't currently offer paid
        bounties — we're a small platform at an early stage — but genuine reports are taken seriously
        and credited if you'd like.
      </p>
    </StaticPageLayout>
  );
}
