import Link from "next/link";
import styles from "./ActionCard.module.css";

// The Overview's "what needs a decision right now" row — a zero count is
// still shown (so an admin can see nothing's waiting), but only lights up
// when there's actually something to act on.
export function ActionCard({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link href={href} className={count > 0 ? styles.cardActive : styles.card}>
      <span className={styles.value}>{count}</span>
      <span className={styles.label}>{label}</span>
    </Link>
  );
}
