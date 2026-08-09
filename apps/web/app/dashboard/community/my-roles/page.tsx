import { MyAssignedRoles } from "@/components/MyAssignedRoles";
import { getChannelsIModerate } from "@/lib/api";
import styles from "../../page.module.css";

export default async function MyAssignedRolesPage() {
  const channels = await getChannelsIModerate();

  return (
    <>
      <h1 className={styles.heading}>My Assigned Roles</h1>
      <p className={styles.subtext}>Channels where you&apos;ve been granted moderator access.</p>
      <MyAssignedRoles channels={channels} />
    </>
  );
}
