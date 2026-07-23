import { SparkleIcon } from "./icons";
import styles from "./AvatarPreviewHero.module.css";

export function AvatarPreviewHero({ svg, pulsing }: { svg: string; pulsing: boolean }) {
  return (
    <div className={styles.wrap}>
      <div className={`${styles.frame} ${pulsing ? styles.framePulse : ""}`}>
        <div className={styles.svgWrap} dangerouslySetInnerHTML={{ __html: svg }} />
        <SparkleIcon className={styles.sparkle} />
      </div>
    </div>
  );
}
