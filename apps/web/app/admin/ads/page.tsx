import { AdCampaignsPanel } from "@/components/admin/AdCampaignsPanel";
import { AdLeadsPanel } from "@/components/admin/AdLeadsPanel";
import { AdRevenuePanel } from "@/components/admin/AdRevenuePanel";
import { AdvertisersPanel } from "@/components/admin/AdvertisersPanel";
import {
  getAdCampaigns,
  getAdLeads,
  getAdRevenueByCreator,
  getAdvertisers,
  getPlatformConfigData,
} from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminAdsPage() {
  const [advertisers, campaigns, leads, revenue, platformConfig] = await Promise.all([
    getAdvertisers(),
    getAdCampaigns(),
    getAdLeads(),
    getAdRevenueByCreator(),
    getPlatformConfigData(),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Ads</h1>

      <h2 className={styles.sectionTitle}>Advertisers</h2>
      <AdvertisersPanel advertisers={advertisers} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Campaigns</h2>
      <AdCampaignsPanel
        campaigns={campaigns}
        advertisers={advertisers}
        prerollSlot1DurationSeconds={platformConfig?.prerollSlot1DurationSeconds ?? 30}
        prerollSlot2SkipAfterSeconds={platformConfig?.prerollSlot2SkipAfterSeconds ?? 5}
      />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Inquiries from /advertisers</h2>
      <AdLeadsPanel leads={leads} />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Revenue by creator</h2>
      <AdRevenuePanel items={revenue} />
    </>
  );
}
