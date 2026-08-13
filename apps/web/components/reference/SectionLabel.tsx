import styles from "./SectionLabel.module.css";

// following.dart/discover.dart's "LIVE CHANNELS"/"RECOMENDED..." headers —
// the reference sets no explicit size/weight/color (theme default), so
// this gives it a real, deliberate treatment using Birq's --ref-section-label
// token rather than leaving it unstyled.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.label}>{children}</h2>;
}
