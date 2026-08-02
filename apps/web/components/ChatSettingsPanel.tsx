"use client";

import { useDropdown } from "@/lib/useDropdown";
import type { ChatSettings } from "@/lib/useChatSettings";
import styles from "./ShareSheet.module.css";
import panelStyles from "./ChatSettingsPanel.module.css";
import { GearIcon } from "./icons";

const FONT_SIZES: { value: ChatSettings["fontSize"]; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

// D.2 chat settings gear — reuses ShareSheet's dropdown chrome (trigger/
// menu), same reasoning as OverflowMenu.
export function ChatSettingsPanel({
  settings,
  onChange,
}: {
  settings: ChatSettings;
  onChange: (patch: Partial<ChatSettings>) => void;
}) {
  const dropdown = useDropdown<HTMLDivElement>();

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button type="button" className={styles.trigger} aria-label="Chat settings" onClick={() => dropdown.setOpen((o) => !o)}>
        <GearIcon />
      </button>
      {dropdown.open && (
        <div className={`${styles.menu} ${panelStyles.panel}`}>
          <label className={panelStyles.row}>
            <span>Large emoji</span>
            <input
              type="checkbox"
              checked={settings.largeEmoji}
              onChange={(e) => onChange({ largeEmoji: e.target.checked })}
            />
          </label>
          <label className={panelStyles.row}>
            <span>Show timestamps</span>
            <input
              type="checkbox"
              checked={settings.showTimestamps}
              onChange={(e) => onChange({ showTimestamps: e.target.checked })}
            />
          </label>
          <div className={panelStyles.row}>
            <span>Font size</span>
            <select
              className={panelStyles.select}
              value={settings.fontSize}
              onChange={(e) => onChange({ fontSize: e.target.value as ChatSettings["fontSize"] })}
            >
              {FONT_SIZES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
