import styles from "./AboutCreator.module.css";

export function AboutCreator({
  displayName,
  bio,
  followerCount,
}: {
  displayName: string;
  bio: string | null;
  followerCount: number;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>About {displayName}</h2>
      <p className={styles.followerCount}>
        {followerCount.toLocaleString()} follower{followerCount === 1 ? "" : "s"}
      </p>
      <p className={styles.bio}>{bio ?? "This creator hasn't added a bio yet."}</p>
    </section>
  );
}
