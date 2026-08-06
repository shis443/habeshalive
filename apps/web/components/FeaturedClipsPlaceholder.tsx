import { GoLiveIcon } from "./icons";
import styles from "./FeaturedClipsPlaceholder.module.css";

// Explicit placeholder, not real functionality — there is no clip system
// anywhere in this codebase (no clips table, no clip-creation mechanism,
// no clip routes) to back a real "Featured Clips" section. Built visually
// distinct (dashed cards, a "Coming soon" label) rather than a normal-
// looking card grid with invented view counts/titles, specifically so a
// real viewer can't mistake this for actual data — see this feature's own
// scoping notes for why a placeholder was the deliberate choice here
// rather than either building a real clips subsystem (its own, much
// larger project) or silently omitting the section shown in the design
// reference.
export function FeaturedClipsPlaceholder() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Featured Clips</h2>
      <div className={styles.row}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.card}>
            <GoLiveIcon className={styles.icon} />
          </div>
        ))}
      </div>
      <p className={styles.note}>Clips aren't available yet — coming in a future update.</p>
    </section>
  );
}
