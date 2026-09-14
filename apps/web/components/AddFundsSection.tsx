import type { TopupProvider } from "@birq/shared";
import { AddFundsRow } from "./AddFundsRow";
import styles from "./AddFundsSection.module.css";
import { WalletIcon } from "./icons";

const METHODS: { name: string; description: string; provider?: TopupProvider }[] = [
  { name: "Telebirr", description: "Pay instantly from your Telebirr wallet" },
  { name: "CBE Birr", description: "Pay with your Commercial Bank of Ethiopia account" },
  { name: "HelloCash", description: "Pay with HelloCash mobile money" },
  // Build 3 — a second, independent gateway (wallet/santimpay-client.ts),
  // not a method inside Chapa's checkout like the three above.
  { name: "SantimPay", description: "Pay with SantimPay", provider: "santimpay" },
];

export function AddFundsSection() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Add funds</h2>
      {METHODS.map((method) => (
        <AddFundsRow
          key={method.name}
          name={method.name}
          description={method.description}
          provider={method.provider}
          icon={<WalletIcon />}
        />
      ))}
    </section>
  );
}
