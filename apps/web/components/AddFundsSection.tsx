import { AddFundsRow } from "./AddFundsRow";
import styles from "./AddFundsSection.module.css";
import { WalletIcon } from "./icons";

const METHODS = [
  { name: "Telebirr", description: "Pay instantly from your Telebirr wallet" },
  { name: "CBE Birr", description: "Pay with your Commercial Bank of Ethiopia account" },
  { name: "HelloCash", description: "Pay with HelloCash mobile money" },
];

export function AddFundsSection() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Add funds</h2>
      {METHODS.map((method) => (
        <AddFundsRow key={method.name} name={method.name} description={method.description} icon={<WalletIcon />} />
      ))}
    </section>
  );
}
