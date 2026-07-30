import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { CreatorApplicationForm } from "@/components/CreatorApplicationForm";
import { TopNav } from "@/components/TopNav";
import { getCreatorApplicationCapStatus, getCurrentUser, getMyCreatorApplication } from "@/lib/api";
import styles from "@/components/StaticPageLayout.module.css";

export default async function ApplyToStreamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/apply-to-stream");

  const [application, capStatus] = await Promise.all([getMyCreatorApplication(), getCreatorApplicationCapStatus()]);
  const capReached = capStatus ? capStatus.approvedCount >= capStatus.cap : false;

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Apply to stream on Birq</h1>
        <div className={styles.prose}>
          <p>
            Birq is launching with a limited first batch of creators
            {capStatus ? ` (${capStatus.approvedCount} of ${capStatus.cap} spots filled)` : ""}. Streaming access
            requires an approved application while this batch fills — this doesn&apos;t affect watching, chatting,
            or gifting, only going live yourself.
          </p>
        </div>
        <CreatorApplicationForm existing={application} capReached={capReached} />
      </main>
      <BottomNav />
    </>
  );
}
