"use client";

import { UI_LANGUAGES } from "@/lib/useLanguage";
import { useChatSettings } from "@/lib/useChatSettings";
import { useLanguage } from "@/lib/useLanguage";
import { useTheme } from "@/lib/useTheme";
import { PrivacyCenterControls } from "./PrivacyCenterControls";
import styles from "./AccountSection.module.css";

// E.5's nav-level gear dropdown has quick versions of these same
// controls — this is the fuller /settings page version, sharing the same
// underlying hooks (useLanguage/useTheme/useChatSettings) so the two
// surfaces can never drift into showing different values for the same
// preference.
export function PreferencesSection({ isAuthed }: { isAuthed: boolean }) {
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { settings: chatSettings, update: updateChatSettings } = useChatSettings();

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Preferences</h2>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="settings-language">
          Language
        </label>
        <select
          id="settings-language"
          className={styles.select}
          value={language}
          onChange={(e) => setLanguage(e.target.value as (typeof UI_LANGUAGES)[number])}
        >
          {UI_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <div className={styles.row}>
          <span className={styles.fieldLabel} style={{ marginBottom: 0, flex: 1 }}>
            Dark theme
          </span>
          <button type="button" className={styles.buttonSecondary} onClick={toggleTheme}>
            {theme === "dark" ? "On" : "Off"}
          </button>
        </div>
        {theme !== "dark" && <p className={styles.hint}>Light mode is out of scope for now — this toggle is visually functional but the app stays dark.</p>}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Chat settings</span>
        <div className={styles.row}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={chatSettings.largeEmoji}
              onChange={(e) => updateChatSettings({ largeEmoji: e.target.checked })}
            />
            Large emoji
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={chatSettings.showTimestamps}
              onChange={(e) => updateChatSettings({ showTimestamps: e.target.checked })}
            />
            Timestamps
          </label>
        </div>
        <p className={styles.hint}>Same settings as the gear icon inside chat.</p>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Labeled content</span>
        <PrivacyCenterControls isAuthed={isAuthed} />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Privacy</span>
        <p className={styles.hint}>
          Who can see your follows, and default gift visibility, aren&apos;t built yet — flagged as
          missing rather than faked here.
        </p>
      </div>
    </div>
  );
}
