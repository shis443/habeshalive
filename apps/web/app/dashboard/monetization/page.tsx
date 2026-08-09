import { AdsManagerPanel } from "@/components/AdsManagerPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { getCreatorAdsSettings, getStreamKey, getWalletBalance } from "@/lib/api";
import accountStyles from "@/components/AccountSection.module.css";
import styles from "../page.module.css";

export default async function MonetizationPage() {
  const streamKey = await getStreamKey();
  const [balance, adsSettings] = await Promise.all([
    getWalletBalance(),
    streamKey ? getCreatorAdsSettings() : Promise.resolve(null),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Monetization</h1>
      <p className={styles.subtext}>Your wallet balance and ad settings.</p>
      <WalletPanel balanceSantim={balance?.balanceSantim ?? 0} />
      {streamKey && <AdsManagerPanel settings={adsSettings} />}

      <div className={accountStyles.card}>
        <h2 className={accountStyles.title}>Earnings export</h2>
        <p className={accountStyles.hint}>
          A CSV of your gross Birr earned per month (gifts, subscriptions, donations, PPV, and ad
          revenue share) — raw data for your own records or accountant. This is not a tax filing
          or a compliance guarantee for any jurisdiction.
        </p>
        <a href="/api/backend/wallet/earnings-export" download="birq-earnings.csv" className={accountStyles.buttonSecondary}>
          Download CSV
        </a>
      </div>
    </>
  );
}
