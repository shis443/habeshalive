"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { UI_LANGUAGES, useLanguage } from "@/lib/useLanguage";
import { useTheme } from "@/lib/useTheme";
import {
  BackIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  GearIcon,
  MoreIcon,
  ProfileIcon,
  SearchIcon,
} from "./icons";
import styles from "./TopNav.module.css";

type SettingsView = "main" | "language" | "labeled-content";

// Advertisers and Gift Card were removed, not just left as placeholders —
// this platform runs on birr gifting, not ads, and platform gift cards
// aren't a scoped feature anywhere in the app. Don't link to pages for
// things that don't exist.
const MORE_GENERAL = [
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
  { label: "Careers", href: "/careers" },
  { label: "Anchor Creator Program", href: "/anchor-creator-program" },
];
const MORE_LEGAL = [
  { label: "Community Guidelines", href: "/community-guidelines" },
  { label: "Privacy Notice", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Safety Center", href: "/safety-center" },
];

// No notifications backend exists yet — 0 is the honest count, not a fake
// placeholder number. The dropdown below always shows an empty state.
const UNREAD_COUNT = 0;

export function TopNav({ isAuthed }: { isAuthed: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const more = useDropdown<HTMLDivElement>();
  const notifications = useDropdown<HTMLDivElement>();
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
            aria-label="More"
            onClick={() => more.setOpen((o) => !o)}
          >
            <MoreIcon />
          </button>
          {more.open && (
            <div className={`${styles.dropdown} ${styles.dropdownWide} ${styles.dropdownLeft}`}>
              <span className={styles.groupLabel}>General</span>
              {MORE_GENERAL.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.menuItem}
                >
                  {item.label}
                </Link>
              ))}
              <div className={styles.divider} />
              <span className={styles.groupLabel}>Help &amp; Legal</span>
              {MORE_LEGAL.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.menuItem}
                >
                  {item.label}
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
          placeholder="Search"
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className={styles.searchButton} aria-label="Search">
          <SearchIcon />
        </button>
      </form>

      <div className={styles.right}>
        <div className={styles.dropdownWrap} ref={notifications.ref}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.badgeWrap}`}
            aria-label="Notifications"
            onClick={() => notifications.setOpen((o) => !o)}
          >
            <BellIcon />
            {UNREAD_COUNT > 0 && <span className={styles.badge}>{UNREAD_COUNT}</span>}
          </button>
          {notifications.open && (
            <div className={styles.dropdown}>
              <p className={styles.emptyState}>No new notifications</p>
            </div>
          )}
        </div>

        <div className={styles.dropdownWrap} ref={settings.ref}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Settings"
            onClick={() => settings.setOpen((o) => !o)}
          >
            <GearIcon />
          </button>
          {settings.open && (
            <div className={`${styles.dropdown} ${styles.dropdownWide}`}>
              {settingsView === "main" && (
                <>
                  <button type="button" className={styles.rowItem} onClick={() => setSettingsView("language")}>
                    <span className={styles.rowLabel}>Language</span>
                    <ChevronRightIcon />
                  </button>
                  <button type="button" className={styles.rowItem} onClick={toggleTheme}>
                    <span className={styles.rowLabel}>Dark theme</span>
                    <span className={`${styles.toggle} ${theme === "dark" ? styles.toggleOn : ""}`}>
                      <span className={`${styles.toggleKnob} ${theme === "dark" ? styles.toggleKnobOn : ""}`} />
                    </span>
                  </button>
                  <Link href="/cookie-preferences" className={styles.menuItem}>
                    Cookies &amp; Ads Choices
                  </Link>
                  <button
                    type="button"
                    className={styles.rowItem}
                    onClick={() => setSettingsView("labeled-content")}
                  >
                    <span className={styles.rowLabel}>Labeled Content</span>
                    <ChevronRightIcon />
                  </button>
                </>
              )}

              {settingsView === "language" && (
                <>
                  <button type="button" className={styles.backRow} onClick={() => setSettingsView("main")}>
                    <BackIcon className={styles.backIcon} />
                    Language
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
                  {language !== "English" && (
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
                    Labeled Content
                  </button>
                  {!isAuthed ? (
                    <p className={styles.settingsNote}>
                      Log in to choose whether streams a creator marks sensitive/mature are shown
                      to you.
                    </p>
                  ) : sensitivePref === null ? (
                    <p className={styles.settingsNote}>Loading…</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.rowItem}
                        onClick={handleToggleSensitive}
                        disabled={sensitiveSaving}
                      >
                        <span className={styles.rowLabel}>Show sensitive/mature content</span>
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
              aria-label="Your account"
              onClick={() => account.setOpen((o) => !o)}
            >
              <ProfileIcon />
            </button>
            {account.open && (
              <div className={styles.dropdown}>
                <Link href="/dashboard" className={styles.menuItem}>
                  Dashboard
                </Link>
                <Link href="/wallet" className={styles.menuItem}>
                  Wallet
                </Link>
                <div className={styles.divider} />
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  {loggingOut ? "Logging out…" : "Log out"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link href="/login" className={styles.loginLink}>
              Log in
            </Link>
            <Link href="/signup" className={styles.signupButton}>
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
