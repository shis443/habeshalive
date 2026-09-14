import { BirqPlusSubscribeForm } from "@/components/BirqPlusSubscribeForm";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getMyPlatformSubscription } from "@/lib/api";
import styles from "./page.module.css";

const PERKS = [
  { emoji: "🚫", title: "Ad-free viewing", body: "No pre-roll or mid-roll ads on any stream, platform-wide." },
  { emoji: "🔰", title: "Sub Shield badge", body: "A distinct badge next to your name in every chat you post in." },
  {
    emoji: "😀",
    title: "Global emote slot",
    body: "Upload a custom emote to the platform-wide catalog — once approved, every chatter can use it.",
  },
  {
    emoji: "🎬",
    title: "Extended VOD retention",
    body: "Your own broadcasts stay up longer before they expire, instead of the platform default.",
  },
];

export default async function BirqPlusPage() {
  const user = await getCurrentUser();
  const subscription = user ? await getMyPlatformSubscription() : null;

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <h1 className={styles.heading}>Birq Plus</h1>
        <p className={styles.subtext}>
          A sliding-scale monthly subscription that supports the platform directly — pick what feels right,
          starting at 150 ETB/month.
        </p>

        <div className={styles.perkGrid}>
          {PERKS.map((perk) => (
            <div key={perk.title} className={styles.perkCard}>
              <span className={styles.perkEmoji}>{perk.emoji}</span>
              <h2 className={styles.perkTitle}>{perk.title}</h2>
              <p className={styles.perkBody}>{perk.body}</p>
            </div>
          ))}
        </div>

        <BirqPlusSubscribeForm isAuthed={!!user} initial={subscription} />
      </main>
      <BottomNav />
    </>
  );
}
