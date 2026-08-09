import { PointsCard } from "@/components/PointsCard";
import { getPointsBalance } from "@/lib/api";
import styles from "../page.module.css";

// Twitch's real "Viewer Rewards" is creator-configurable (Channel Points
// names/rewards, Drops, Emotes) — this platform's closest real equivalent
// is Watch-to-Earn points (apps/api/src/points/service.ts), but it's a
// platform-wide mechanic (daily cap, accrual rate) rather than something
// each creator tunes, and there's no emote marketplace or Drops/publisher
// integration at all. This page shows what's real — your own balance as
// a viewer, since a creator watches other channels too — rather than a
// configuration UI for something that isn't actually configurable here.
export default async function ViewerRewardsPage() {
  const balance = await getPointsBalance();

  return (
    <>
      <h1 className={styles.heading}>Viewer Rewards</h1>
      <p className={styles.subtext}>
        Birq Points are earned platform-wide by watching streams and can be redeemed for wallet credit — there&apos;s
        no per-channel configuration (no custom rewards, emotes, or Drops) yet.
      </p>
      <PointsCard balance={balance} />
    </>
  );
}
