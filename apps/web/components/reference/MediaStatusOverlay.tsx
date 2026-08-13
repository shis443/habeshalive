import styles from "./MediaStatusOverlay.module.css";

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Variant = "live" | "dark";

const POSITION_CLASS: Record<Position, string> = {
  "top-left": styles.topLeft!,
  "top-right": styles.topRight!,
  "bottom-left": styles.bottomLeft!,
  "bottom-right": styles.bottomRight!,
};

// live_tile_large/medium's LIVE badge (variant="live": radius 4, pad
// 1v/4h, red bg) and viewer-count pill / video_tile_medium's duration+
// views+date badges (variant="dark": radius 5, pad 2v/6h, dark-gradient
// bg) — one shared overlay primitive for every badge that sits on top of
// a thumbnail across the card system, all real, database-backed text
// passed in as children (never a hardcoded label here).
export function MediaStatusOverlay({
  position,
  variant,
  children,
}: {
  position: Position;
  variant: Variant;
  children: React.ReactNode;
}) {
  return (
    <span className={`${styles.overlay} ${styles[variant]} ${POSITION_CLASS[position]}`}>{children}</span>
  );
}
