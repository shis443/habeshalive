"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { useLanguage, type UiLanguage } from "@/lib/useLanguage";
import amMessages from "@/messages/am.json";
import enMessages from "@/messages/en.json";
import omMessages from "@/messages/om.json";
import soMessages from "@/messages/so.json";
import tiMessages from "@/messages/ti.json";

// All five UI_LANGUAGES options now have a real message catalog (nav/menu
// chrome plus the watch/embed/chat/gursha/actionRow strings — see each
// json file). Coverage is NOT uniform quality across languages, though:
// Amharic is a native/fluent pass, English is the source of truth, but
// om/ti/so were filled in without a native-speaker review pass — see
// docs/i18n-translation-review.md for exactly which keys came from a
// human-supplied translation vs. best-effort AI fill-in, before treating
// any of the three as production-verified copy. This only affects
// translation *quality*, not whether the mechanism works — the plumbing
// itself (locale selection -> correct catalog loading) is the same for
// all five.
const MESSAGES_BY_LOCALE = {
  en: enMessages,
  am: amMessages,
  om: omMessages,
  ti: tiMessages,
  so: soMessages,
} as const;

const LOCALE_BY_LANGUAGE: Record<UiLanguage, keyof typeof MESSAGES_BY_LOCALE> = {
  English: "en",
  Amharic: "am",
  Oromo: "om",
  Tigrinya: "ti",
  Somali: "so",
};

function localeForLanguage(language: string): keyof typeof MESSAGES_BY_LOCALE {
  return (LOCALE_BY_LANGUAGE as Record<string, keyof typeof MESSAGES_BY_LOCALE>)[language] ?? "en";
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
