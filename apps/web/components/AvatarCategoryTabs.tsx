import type { AvatarCategory } from "@habeshalive/shared";
import styles from "./AvatarCategoryTabs.module.css";

const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  background: "Background",
  skin_tone: "Skin Tone",
  hair: "Hair",
  hair_color: "Hair Color",
  eyes: "Eyes",
  eyebrows: "Eyebrows",
  mouth: "Mouth",
  facial_hair: "Facial Hair",
  accessories: "Accessories",
  clothing: "Clothing",
  clothes_color: "Clothing Color",
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
