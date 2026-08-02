"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "birq:chat-settings";

export interface ChatSettings {
  largeEmoji: boolean;
  showTimestamps: boolean;
  fontSize: "small" | "medium" | "large";
}

const DEFAULTS: ChatSettings = { largeEmoji: true, showTimestamps: false, fontSize: "medium" };

// Single-instance preference (only one ChatPanel renders per page, unlike
// useLanguage/useTheme which multiple independent components read) — a
// plain useState + localStorage read-on-mount is enough, no shared
// external store needed.
export function useChatSettings() {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULTS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSettings({ ...DEFAULTS, ...JSON.parse(stored) });
    } catch {
      // Corrupt/absent storage just falls back to defaults.
    }
  }, []);

  function update(patch: Partial<ChatSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { settings, update };
}
