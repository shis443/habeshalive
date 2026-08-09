import { AdsManagerPanel } from "@/components/AdsManagerPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { getCreatorAdsSettings, getStreamKey, getWalletBalance } from "@/lib/api";
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
    </>
  );
}
