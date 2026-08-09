import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

// The one reusable loading-state primitive for the whole app — every
// route's loading.tsx composes real content shapes (matching that page's
// actual CSS grid/flex structure, so nothing jumps when real data lands)
// out of these blocks rather than each page inventing its own shimmer.
export function Skeleton({
  className,
  style,
  circle = false,
}: {
  className?: string;
  style?: CSSProperties;
  circle?: boolean;
}) {
  return <span className={`${styles.skeleton} ${circle ? styles.circle : ""} ${className ?? ""}`} style={style} aria-hidden="true" />;
}
