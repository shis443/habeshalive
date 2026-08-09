import { FollowersList } from "@/components/FollowersList";
import { getMyFollowers } from "@/lib/api";
import styles from "../../page.module.css";

export default async function FollowersPage() {
  const followers = await getMyFollowers();

  return (
    <>
      <h1 className={styles.heading}>Followers</h1>
      <p className={styles.subtext}>
        {followers.length} {followers.length === 1 ? "person follows" : "people follow"} your channel.
      </p>
      <FollowersList followers={followers} />
    </>
  );
}
