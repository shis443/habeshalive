"use client";

import type { CatalogEmote } from "@birq/shared";
import { useDropdown } from "@/lib/useDropdown";
import styles from "./EmojiPickerButton.module.css";
import { EmojiIcon } from "./icons";

// Build 3 — Birq Plus's "global emote slot" catalog (apps/api/src/emotes/
// service.ts), the custom-image sibling of EmojiPickerButton's hardcoded
// unicode list right next to it in ChatPanel.tsx's input row. Reuses that
// component's exact CSS module — same picker chrome, an <img> grid
// instead of an emoji-text grid.
export function EmotePickerButton({
  emotes,
  onSelect,
}: {
  emotes: CatalogEmote[];
  onSelect: (code: string) => void;
}) {
  const dropdown = useDropdown<HTMLDivElement>();

  if (emotes.length === 0) return null;

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={styles.button}
        aria-label="Emote picker"
        onClick={() => dropdown.setOpen((o) => !o)}
      >
        <EmojiIcon />
      </button>
      {dropdown.open && (
        <div className={styles.grid}>
          {emotes.map((emote) => (
            <button
              key={emote.id}
              type="button"
              className={styles.emoji}
              title={`:${emote.code}:`}
              onClick={() => {
                onSelect(emote.code);
                dropdown.setOpen(false);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emote.imageUrl} alt={emote.code} width={20} height={20} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
