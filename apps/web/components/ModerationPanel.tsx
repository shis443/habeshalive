import styles from "./ModerationPanel.module.css";

// Static placeholder — auto-mod, blocked-word lists, and a timeout queue
// have no backing tables in the schema (only a generic moderation_actions
// log exists). This is Phase 5+ moderation tooling, not wired up here.
export function ModerationPanel() {
  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Moderation</h2>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Auto-mod (Amharic)</span>
        <span className={styles.statusOff}>Off</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Blocked words</span>
        <span className={styles.rowValue}>0</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Timeout queue</span>
        <span className={styles.rowValue}>0</span>
      </div>
      <span className={styles.manageLink} title="Coming soon">
        Manage rules
      </span>
    </section>
  );
}
