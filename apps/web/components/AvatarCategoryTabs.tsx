import type { AvatarCategory } from "@habeshalive/shared";
import styles from "./AvatarCategoryTabs.module.css";

const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  background: "Background",
  skin_tone: "Skin Tone",
  hair: "Hair",
  eyes: "Eyes",
  accessories: "Accessories",
};

export function AvatarCategoryTabs({
  categories,
  active,
  onChange,
}: {
  categories: AvatarCategory[];
  active: AvatarCategory;
  onChange: (category: AvatarCategory) => void;
}) {
  return (
    <div className={styles.tabs}>
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          className={category === active ? styles.tabActive : styles.tab}
          onClick={() => onChange(category)}
        >
          {CATEGORY_LABELS[category]}
        </button>
      ))}
    </div>
  );
}
