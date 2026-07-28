"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "birq-ui-language";

export const UI_LANGUAGES = ["English", "Amharic", "Oromo", "Tigrinya", "Somali"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function useLanguage() {
  const [language, setLanguageState] = useState<UiLanguage>("English");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (UI_LANGUAGES as readonly string[]).includes(stored)) {
      setLanguageState(stored as UiLanguage);
    }
  }, []);

  function setLanguage(next: UiLanguage) {
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }

  return { language, setLanguage };
}
