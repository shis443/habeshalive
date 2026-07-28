import { AnchorCandidatesList } from "@/components/admin/AnchorCandidatesList";
import { CurrentAnchorsList } from "@/components/admin/CurrentAnchorsList";
import { getAnchorCandidates, getAnchorCreators } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminAnchorProgramPage() {
  const [anchors, candidates] = await Promise.all([getAnchorCreators(), getAnchorCandidates()]);

  return (
    <>
      <h1 className={styles.heading}>Anchor Creator Program</h1>
      <p className={styles.subtext}>
        There&apos;s no self-serve application flow yet — creators reach out by email and the team follows up
        directly. This ranks existing creators by real revenue generated (gifts, boosts, subscriptions) so there&apos;s
        something concrete to work from when deciding who to reach out to. Promoting someone still uses the same
        toggle as the Creators page.
      </p>

      <h2 className={styles.sectionTitle}>Current anchor creators</h2>
      <CurrentAnchorsList items={anchors} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Candidates, ranked by lifetime earnings</h2>
      <AnchorCandidatesList items={candidates} />
    </>
  );
}
