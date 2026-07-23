import styles from "./CategoryPills.module.css";

const CATEGORIES = ["All", "Music", "Gaming", "Traditional", "Just Chatting"];

export function CategoryPills() {
  return (
    <div className={styles.scroll}>
      {CATEGORIES.map((category, index) => (
        <span key={category} className={index === 0 ? styles.pillActive : styles.pill}>
          {category}
        </span>
      ))}
    </div>
  );
}
