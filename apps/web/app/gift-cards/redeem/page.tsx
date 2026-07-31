import { formatSantimAsBirr } from "@habeshalive/shared";
import { BottomNav } from "@/components/BottomNav";
import { GiftCardRedeemButton } from "@/components/GiftCardRedeemButton";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getGiftCardPreview } from "@/lib/api";
import styles from "@/components/StaticPageLayout.module.css";

export default async function RedeemGiftCardPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const [user, card] = await Promise.all([getCurrentUser(), code ? getGiftCardPreview(code) : Promise.resolve(null)]);

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <h1 className={styles.heading}>Redeem a Gift Card</h1>
        <div className={styles.prose}>
          {!code && <p>No gift card code provided.</p>}
          {code && !card && <p>This gift card code wasn&apos;t found.</p>}
          {card && card.status === "redeemed" && <p>This gift card has already been redeemed.</p>}
          {card && card.status === "cancelled" && <p>This gift card was cancelled.</p>}
          {card && card.status === "expired" && <p>This gift card has expired.</p>}
          {card && card.status === "issued" && (
            <>
              <p>
                {card.purchaserDisplayName ?? "Someone"} sent you a{" "}
                <strong>{formatSantimAsBirr(card.amountSantim)}</strong> Birq gift card.
              </p>
              {card.personalMessage && <p><em>&ldquo;{card.personalMessage}&rdquo;</em></p>}
              <GiftCardRedeemButton code={card.code} isAuthed={!!user} amountSantim={card.amountSantim} />
            </>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
