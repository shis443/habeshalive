import { formatSantimAsBirr, type MyGiftCard } from "@habeshalive/shared";
import Link from "next/link";
import styles from "./SubscriptionsList.module.css";

const STATUS_LABEL: Record<MyGiftCard["status"], string> = {
  issued: "Issued",
  redeemed: "Redeemed",
  expired: "Expired",
  cancelled: "Cancelled",
};

function statusClass(status: MyGiftCard["status"]): string {
  switch (status) {
    case "issued":
      return styles.statusActive ?? "";
    case "redeemed":
      return styles.statusEnded ?? "";
    case "expired":
    case "cancelled":
      return styles.statusWarning ?? "";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function MyGiftCardsList({ giftCards }: { giftCards: MyGiftCard[] }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>Gift cards you&apos;ve sent</h2>
      {giftCards.length === 0 ? (
        <p className={styles.empty}>
          You haven&apos;t sent any gift cards yet. <Link href="/gift-cards">Buy one</Link>.
        </p>
      ) : (
        giftCards.map((card) => (
          <div key={card.id} className={styles.row}>
            <div>
              <p className={styles.title}>{formatSantimAsBirr(card.amountSantim)} — {card.designTheme.replace("_", " ")}</p>
              <p className={styles.meta}>
                {card.recipientEmail ?? card.recipientPhone ?? "Shareable link"} · Sent {formatDate(card.createdAt)}
                {card.scheduledDeliveryAt && ` · Scheduled ${formatDate(card.scheduledDeliveryAt)}`}
              </p>
            </div>
            <span className={`${styles.statusPill} ${statusClass(card.status)}`}>{STATUS_LABEL[card.status]}</span>
          </div>
        ))
      )}
    </div>
  );
}
