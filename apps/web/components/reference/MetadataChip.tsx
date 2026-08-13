import styles from "./MetadataChip.module.css";

// text_tag.dart: borderRadius 15 (pill), theme-dependent grey800/grey300
// bg, no per-instance color param — same fixed two-tone treatment here,
// via Birq's own surface tokens instead of literal grey values.
export function MetadataChip({ children }: { children: React.ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}
