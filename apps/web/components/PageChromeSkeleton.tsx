import { Skeleton } from "./Skeleton";
import styles from "./PageChromeSkeleton.module.css";

// TopNav/BottomNav themselves don't fetch anything slow, but every real
// page.tsx that renders them is itself an async Server Component doing
// its own data fetch — Next's loading.tsx replaces that component's
// entire returned tree (chrome included) until it resolves. Approximating
// the header/bottom bar here (rather than trying to render the real
// TopNav/BottomNav with a guessed auth state) is what keeps the loading
// state from flashing an unstyled or misaligned page underneath it.
export function HeaderSkeleton() {
  return (
    <div className={styles.header}>
      <Skeleton style={{ width: 32, height: 32 }} circle />
      <Skeleton style={{ width: 90, height: 20 }} />
      <div className={styles.headerRight}>
        <Skeleton style={{ width: 24, height: 24 }} circle />
        <Skeleton style={{ width: 24, height: 24 }} circle />
        <Skeleton style={{ width: 28, height: 28 }} circle />
      </div>
    </div>
  );
}

export function BottomNavSkeleton() {
  return (
    <div className={styles.bottomNav}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} style={{ width: 40, height: 32 }} />
      ))}
    </div>
  );
}
