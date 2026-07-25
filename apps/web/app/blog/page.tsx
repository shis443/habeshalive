import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function BlogPage() {
  return (
    <StaticPageLayout title="Blog">
      <div className={styles.placeholderCard}>
        <p>Nothing published here yet — check back soon.</p>
      </div>
    </StaticPageLayout>
  );
}
