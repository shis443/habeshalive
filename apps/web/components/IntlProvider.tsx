"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/useLanguage";
import amMessages from "@/messages/am.json";
import enMessages from "@/messages/en.json";

// Only Amharic has a real message catalog so far — every other
// UI_LANGUAGES option (Oromo, Tigrinya, Somali) still renders the English
// chrome, same as before this existed. See useLanguage.ts's STORAGE_KEY:
// the picker already let people choose those, this just makes English and
// Amharic actually take effect instead of only being saved.
const MESSAGES_BY_LOCALE = { en: enMessages, am: amMessages } as const;

function localeForLanguage(language: string): keyof typeof MESSAGES_BY_LOCALE {
  return language === "Amharic" ? "am" : "en";
}

// No server-side locale resolution (no cookie, no middleware, no
// next-intl/server) — this mirrors how useTheme/useLanguage already work
// in this app: a client-only localStorage preference, English on the
// server-rendered first paint, reconciled after mount. A translated-text
// flash is more noticeable than the theme's color flash, but avoiding it
// would mean introducing an SSR-locale mechanism (cookies, middleware)
// this codebase doesn't have anywhere else yet.
export function IntlProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const locale = localeForLanguage(language);
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES_BY_LOCALE[locale]} timeZone="Africa/Addis_Ababa">
      {children}
    </NextIntlClientProvider>
  );
}
