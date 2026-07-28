import { CreatorsList } from "@/components/admin/CreatorsList";
import { getCreators } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const creators = await getCreators(q);

  return (
    <>
      <h1 className={styles.heading}>Creators</h1>
      <form action="/admin/creators" className={styles.filterForm}>
        <input type="text" name="q" className={styles.filterInput} placeholder="Search by username" defaultValue={q ?? ""} />
      </form>
      <CreatorsList items={creators} />
    </>
  );
}
