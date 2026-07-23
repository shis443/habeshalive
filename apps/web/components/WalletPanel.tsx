import { formatSantimAsBirr } from "@habeshalive/shared";
import Link from "next/link";
import styles from "./WalletPanel.module.css";

export function WalletPanel({ balanceSantim }: { balanceSantim: number }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Telebirr wallet</h2>
      <p className={styles.balance}>{formatSantimAsBirr(balanceSantim)}</p>
      <Link href="/wallet" className={styles.withdrawButton}>
        Withdraw to Telebirr
      </Link>
    </section>
  );
}
