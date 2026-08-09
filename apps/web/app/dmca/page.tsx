import { DmcaReportForm } from "@/components/DmcaReportForm";
import { StaticPageLayout } from "@/components/StaticPageLayout";

export default function DmcaPage() {
  return (
    <StaticPageLayout title="Copyright (DMCA) Takedown">
      <p>
        If you believe content on Birq infringes your copyright, you can submit a takedown notice below. This process
        is modeled on the U.S. Digital Millennium Copyright Act (17 U.S.C. 512), but is not a substitute for legal
        advice — if you&apos;re unsure whether this applies to your situation, consult an attorney.
      </p>
      <p>
        Submitting a false notice can carry legal consequences. By submitting this form you confirm the statements
        below under penalty of perjury.
      </p>
      <p>
        If your content was removed and you believe that was a mistake, the creator can respond with a counter-notice
        from their account after a report resolves against them.
      </p>
      <DmcaReportForm />
    </StaticPageLayout>
  );
}
