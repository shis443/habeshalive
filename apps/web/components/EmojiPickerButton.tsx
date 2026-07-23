"use client";

import { useDropdown } from "@/lib/useDropdown";
import { EmojiIcon } from "./icons";
import styles from "./EmojiPickerButton.module.css";

const EMOJIS = ["😀", "😂", "❤️", "🔥", "👏", "🎉", "😮", "😢", "🙌", "💯"];

export function EmojiPickerButton({ onSelect }: { onSelect: (emoji: string) => void }) {
  const dropdown = useDropdown<HTMLDivElement>();

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={styles.button}
        aria-label="Emoji picker"
        onClick={() => dropdown.setOpen((o) => !o)}
      >
        <EmojiIcon />
      </button>
      {dropdown.open && (
        <div className={styles.grid}>
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.emoji}
              onClick={() => {
                onSelect(emoji);
                dropdown.setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
