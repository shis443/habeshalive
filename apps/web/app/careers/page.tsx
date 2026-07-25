import { StaticPageLayout } from "@/components/StaticPageLayout";
import styles from "@/components/StaticPageLayout.module.css";

export default function CareersPage() {
  return (
    <StaticPageLayout title="Careers">
      <div className={styles.placeholderCard}>
        <p>Not hiring yet — check back soon.</p>
        <p>
          In the meantime, reach us at{" "}
          <a href="mailto:careers@habeshalive.com">careers@habeshalive.com</a>.
        </p>
      </div>
    </StaticPageLayout>
  );
}
