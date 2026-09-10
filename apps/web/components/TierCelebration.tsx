import { useEffect } from "react";
import styles from "./TierCelebration.module.css";

// Shown instead of the plain success checkmark when a Gursha send actually
// crosses a gifter-badge tier or platform rank threshold — mirrors the
// Flutter consumer app's BirqTierCelebration. `elaborateness` (0-1) scales
// the tibeb-style border treatment: a rank-up (the bigger, rarer moment)
// gets the fuller treatment than a badge tier-up.
export function TierCelebration({
  label,
  title,
  elaborateness,
  onDone,
}: {
  label: string;
  title: string;
  elaborateness: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className={styles.overlay} role="status">
      <div
        className={styles.frame}
        style={{ "--elaborateness": elaborateness } as React.CSSProperties}
      >
        <p className={styles.label}>{label}</p>
        <p className={styles.title}>{title}</p>
      </div>
    </div>
  );
}
