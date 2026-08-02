"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import { useDropdown } from "@/lib/useDropdown";
import { UI_LANGUAGES, useLanguage } from "@/lib/useLanguage";
import { useTheme } from "@/lib/useTheme";
import {
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  GearIcon,
  MoreIcon,
  ProfileIcon,
  SearchIcon,
} from "./icons";
import { NotificationBell } from "./NotificationBell";
import styles from "./TopNav.module.css";

type SettingsView = "main" | "language" | "labeled-content";

// Advertisers and Ad Choices are real now (B.2's house ad server) — link
// to them the same as everything else that's actually built. Only link to
// pages that exist; skip whatever still doesn't (Download Apps, Press,
// Developers, Music on Birq — no native apps or that content exist yet).
const MORE_GENERAL = [
  { labelKey: "browse", href: "/browse" },
  { labelKey: "help", href: "/help" },
  { labelKey: "about", href: "/about" },
  { labelKey: "advertisers", href: "/advertisers" },
  { labelKey: "blog", href: "/blog" },
  { labelKey: "careers", href: "/careers" },
  { labelKey: "giftCards", href: "/gift-cards" },
  { labelKey: "anchorProgram", href: "/anchor-creator-program" },
] as const;
const MORE_LEGAL = [
  { labelKey: "communityGuidelines", href: "/community-guidelines" },
  { labelKey: "privacyNotice", href: "/privacy" },
  { labelKey: "privacyCenter", href: "/privacy-center" },
  { labelKey: "cookieNotice", href: "/cookie-preferences" },
  { labelKey: "adChoices", href: "/ad-choices" },
  { labelKey: "terms", href: "/terms" },
  { labelKey: "accessibility", href: "/accessibility" },
  { labelKey: "security", href: "/security" },
  { labelKey: "safetyCenter", href: "/safety-center" },
  { labelKey: "allLegalDocs", href: "/legal" },
] as const;

export function TopNav({ isAuthed }: { isAuthed: boolean }) {
  const router = useRouter();
  const t = useTranslations("nav");
  const tGeneral = useTranslations("moreGeneral");
  const tLegal = useTranslations("moreLegal");
  const [query, setQuery] = useState("");

  const more = useDropdown<HTMLDivElement>();
  const settings = useDropdown<HTMLDivElement>();
  const account = useDropdown<HTMLDivElement>();
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const [settingsView, setSettingsView] = useState<SettingsView>("main");
  const [sensitivePref, setSensitivePref] = useState<boolean | null>(null);
  const [sensitiveSaving, setSensitiveSaving] = useState(false);

  // Reset to the top-level list every time the dropdown is reopened, so it
  // never reopens on a stale sub-panel from last time.
  useEffect(() => {
    if (!settings.open) setSettingsView("main");
  }, [settings.open]);

  useEffect(() => {
    if (settingsView !== "labeled-content" || !isAuthed || sensitivePref !== null) return;
    fetch("/api/backend/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSensitivePref(Boolean(data.showSensitiveContent));
      })
      .catch(() => {
        // Leave sensitivePref null — the panel just shows "Loading…"
        // indefinitely rather than a broken toggle with an unknown state.
      });
  }, [settingsView, isAuthed, sensitivePref]);

  async function handleToggleSensitive() {
    if (sensitivePref === null) return;
    const next = !sensitivePref;
    setSensitiveSaving(true);
    try {
      const res = await fetch("/api/backend/auth/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showSensitiveContent: next }),
      });
      if (res.ok) {
        setSensitivePref(next);
        // Any stream list already rendered on this page was filtered
        // server-side by the old preference — refresh so it reflects the
        // new one immediately instead of only on the next navigation.
        router.refresh();
      }
    } finally {
      setSensitiveSaving(false);
    }
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      // Hard navigation, not router.push+refresh — that pairing proved
      // unreliable on repeat cross-route navigations in this app (see
      // LoginForm.tsx's login/signup handlers for the same fix and the
      // full diagnosis). Redirects regardless of whether the DELETE call
      // succeeded — an expired/already-invalid session shouldn't be able
      // to strand someone on a page that still thinks they're logged in.
      window.location.href = "/";
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.dropdownWrap} ref={more.ref}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("more")}
            onClick={() => more.setOpen((o) => !o)}
          >
            <MoreIcon />
          </button>
          {more.open && (
            <div className={`${styles.dropdown} ${styles.dropdownWide} ${styles.dropdownLeft}`}>
              <span className={styles.groupLabel}>{t("groupGeneral")}</span>
              {MORE_GENERAL.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.menuItem}
                >
                  {tGeneral(item.labelKey)}
                </Link>
              ))}
              <div className={styles.divider} />
              <span className={styles.groupLabel}>{t("groupHelpLegal")}</span>
              {MORE_LEGAL.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.menuItem}
                >
                  {tLegal(item.labelKey)}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link href="/" className={styles.wordmark}>
          <Image src="/icons/ibex-mark.png" alt="" width={29} height={30} className={styles.mark} priority />
          Birq
        </Link>
      </div>

      <form className={styles.searchForm} onSubmit={handleSearch}>
        <input
          type="search"
          placeholder={t("search")}
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className={styles.searchButton} aria-label={t("search")}>
          <SearchIcon />
        </button>
      </form>

      <div className={styles.right}>
        <NotificationBell isAuthed={isAuthed} />

        <div className={styles.dropdownWrap} ref={settings.ref}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("settings")}
            onClick={() => settings.setOpen((o) => !o)}
          >
            <GearIcon />
          </button>
          {settings.open && (
            <div className={`${styles.dropdown} ${styles.dropdownWide}`}>
              {settingsView === "main" && (
                <>
                  <button type="button" className={styles.rowItem} onClick={() => setSettingsView("language")}>
                    <span className={styles.rowLabel}>{t("language")}</span>
                    <ChevronRightIcon />
                  </button>
                  <button type="button" className={styles.rowItem} onClick={toggleTheme}>
                    <span className={styles.rowLabel}>{t("darkTheme")}</span>
                    <span className={`${styles.toggle} ${theme === "dark" ? styles.toggleOn : ""}`}>
                      <span className={`${styles.toggleKnob} ${theme === "dark" ? styles.toggleKnobOn : ""}`} />
                    </span>
                  </button>
                  <Link href="/cookie-preferences" className={styles.menuItem}>
                    {t("cookiesAds")}
                  </Link>
                  <button
                    type="button"
                    className={styles.rowItem}
                    onClick={() => setSettingsView("labeled-content")}
                  >
                    <span className={styles.rowLabel}>{t("labeledContent")}</span>
                    <ChevronRightIcon />
                  </button>
                  {isAuthed && (
                    <>
                      <div className={styles.divider} />
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={handleLogout}
                        disabled={loggingOut}
                      >
                        {loggingOut ? t("loggingOut") : t("logOut")}
                      </button>
                    </>
                  )}
                </>
              )}

              {settingsView === "language" && (
                <>
                  <button type="button" className={styles.backRow} onClick={() => setSettingsView("main")}>
                    <BackIcon className={styles.backIcon} />
                    {t("language")}
                  </button>
                  {UI_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={styles.rowItem}
                      onClick={() => setLanguage(lang)}
                    >
                      <span className={styles.rowLabel}>{lang}</span>
                      {language === lang && <CheckIcon className={styles.checkMark} />}
                    </button>
                  ))}
                  {language === "Amharic" && (
                    <p className={styles.settingsNote}>
                      Amharic saved — navigation and menus are translated. Most page content is
                      still English while full translation coverage is worked on.
                    </p>
                  )}
                  {language !== "English" && language !== "Amharic" && (
                    <p className={styles.settingsNote}>
                      {language} saved. The interface itself is still English-only — full
                      translation is coming later.
                    </p>
                  )}
                </>
              )}

              {settingsView === "labeled-content" && (
                <>
                  <button type="button" className={styles.backRow} onClick={() => setSettingsView("main")}>
                    <BackIcon className={styles.backIcon} />
                    {t("labeledContent")}
                  </button>
                  {!isAuthed ? (
                    <p className={styles.settingsNote}>
                      Log in to choose whether streams a creator marks sensitive/mature are shown
                      to you.
                    </p>
                  ) : sensitivePref === null ? (
                    <p className={styles.settingsNote}>{t("loading")}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.rowItem}
                        onClick={handleToggleSensitive}
                        disabled={sensitiveSaving}
                      >
                        <span className={styles.rowLabel}>{t("showSensitive")}</span>
                        <span className={`${styles.toggle} ${sensitivePref ? styles.toggleOn : ""}`}>
                          <span className={`${styles.toggleKnob} ${sensitivePref ? styles.toggleKnobOn : ""}`} />
                        </span>
                      </button>
                      <p className={styles.settingsNote}>
                        Off by default. Streams marked sensitive/mature are left out of your
                        browse and search results entirely until you turn this on.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {isAuthed ? (
          <div className={styles.dropdownWrap} ref={account.ref}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("yourAccount")}
              onClick={() => account.setOpen((o) => !o)}
            >
              <ProfileIcon />
            </button>
            {account.open && (
              <div className={styles.dropdown}>
                {/* E.1: Dashboard and Wallet were duplicating what's
                    already in the primary nav (BottomNav) — this dropdown
                    is just Account/Settings now. Log out and Switch
                    account moved inside Settings, deliberately not one
                    accidental click away from here. */}
                <Link href="/account" className={styles.menuItem}>
                  Account
                </Link>
                <Link href="/settings" className={styles.menuItem}>
                  Settings
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* E.4: opens the auth modal — /login stays reachable as a
                direct-link fallback (deep links, redirects after a gated
                action from a page that isn't client-rendered) but the nav
                buttons no longer navigate away from wherever the visitor
                already is. */}
            <button type="button" className={styles.loginLink} onClick={() => openAuthModal("login")}>
              {t("logIn")}
            </button>
            <button type="button" className={styles.signupButton} onClick={() => openAuthModal("signup")}>
              {t("signUp")}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
