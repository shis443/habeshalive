import { UsersList } from "@/components/admin/UsersList";
import { getAdminUsers } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const users = await getAdminUsers(q);

  return (
    <>
      <h1 className={styles.heading}>Users</h1>
      <form action="/admin/users" className={styles.filterForm}>
        <input
          type="text"
          name="q"
          className={styles.filterInput}
          placeholder="Search by username, phone, or email"
          defaultValue={q ?? ""}
        />
      </form>
      <UsersList items={users} />
    </>
  );
}
