"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "birq-ui-language";

export const UI_LANGUAGES = ["English", "Amharic", "Oromo", "Tigrinya", "Somali"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

// A module-level external store (not a per-component useState) — useLanguage
// is called independently by both TopNav (the picker) and IntlProvider (the
// consumer that needs to react to it). Two separate useState instances would
// never see each other's updates; useSyncExternalStore keeps every caller in
// sync with the same value, in the same tab, without needing a React Context
// provider wired through the tree.
let currentLanguage: UiLanguage = "English";
const listeners = new Set<() => void>();

function readInitial(): UiLanguage {
  if (typeof window === "undefined") return "English";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && (UI_LANGUAGES as readonly string[]).includes(stored) ? (stored as UiLanguage) : "English";
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return currentLanguage;
}

function getServerSnapshot() {
  return "English" as UiLanguage;
}

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function setLanguage(next: UiLanguage) {
    currentLanguage = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((callback) => callback());
  }

  return { language, setLanguage };
}

// Reconciles the store with whatever was persisted from a previous visit —
// runs once, on first import in the browser, before any component's effects
// (matching the same "read localStorage after mount" timing every other
// preference in this app uses, e.g. useTheme).
if (typeof window !== "undefined") {
  currentLanguage = readInitial();
}
