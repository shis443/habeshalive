import { PlatformConfigForm } from "@/components/admin/PlatformConfigForm";
import { getPlatformConfigData } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminSettingsPage() {
  const config = await getPlatformConfigData();

  return (
    <>
      <h1 className={styles.heading}>Settings</h1>
      <p className={styles.subtext}>
        Centralized platform config — boost pricing, default creator revenue share, payout review threshold, and VOD
        retention. Everything here used to be hardcoded constants; changing a value takes effect immediately.
      </p>
      <PlatformConfigForm config={config} />
    </>
  );
}
