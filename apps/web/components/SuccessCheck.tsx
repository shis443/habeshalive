import styles from "./SuccessCheck.module.css";

// The one shared "action confirmed" moment across the app — login,
// KYC submission, clip creation, subscribing, and a Gursha send all
// used to end with either a hard navigation or a plain text message.
// Mirrors the Flutter consumer app's BirqSuccessCheck/showBirqSuccessOverlay
// pattern so the confirmation language matches across platforms.
export function SuccessCheck({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className={styles.wrap} role="status">
      <svg className={styles.circle} viewBox="0 0 52 52" aria-hidden="true">
        <circle className={styles.circleTrack} cx="26" cy="26" r="24" />
        <path className={styles.check} d="M14 27l7 7 17-17" />
      </svg>
      <p className={styles.title}>{title}</p>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  );
}
