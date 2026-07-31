import Link from "next/link";
import { StaticPageLayout } from "@/components/StaticPageLayout";

const LEGAL_DOCS = [
  { label: "Terms", href: "/terms", description: "The agreement covering your use of Birq." },
  { label: "Privacy Notice", href: "/privacy", description: "What data we collect and how it's used." },
  {
    label: "Community Guidelines",
    href: "/community-guidelines",
    description: "What's allowed in streams, chat, and gift messages.",
  },
  {
    label: "Cookie Notice",
    href: "/cookie-preferences",
    description: "What cookies Birq sets and your choices around them.",
  },
  { label: "Ad Choices", href: "/ad-choices", description: "What ad targeting Birq uses and your choices." },
  {
    label: "Accessibility Statement",
    href: "/accessibility",
    description: "Our commitment to usability with assistive technology.",
  },
  { label: "Security", href: "/security", description: "How to report a vulnerability, and our safe harbor." },
  { label: "Safety Center", href: "/safety-center", description: "How to report something, and what happens next." },
];

export default function AllLegalDocsPage() {
  return (
    <StaticPageLayout title="All Legal Docs">
      <p>Every legal and safety document for Birq, in one place.</p>
      <ul>
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.href}>
            <Link href={doc.href}>{doc.label}</Link> — {doc.description}
          </li>
        ))}
      </ul>
    </StaticPageLayout>
  );
}
