import { StreamKeyRow } from "./StreamKeyRow";
import styles from "./StreamSetupPanel.module.css";

export function StreamSetupPanel({ rtmpUrl, streamKey }: { rtmpUrl: string; streamKey: string }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Stream setup</h2>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>RTMP server URL</span>
        <code className={styles.readonlyValue}>{rtmpUrl}</code>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Stream key</span>
        <StreamKeyRow initialStreamKey={streamKey} />
      </div>
    </section>
  );
}
