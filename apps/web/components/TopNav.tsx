"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useDropdown } from "@/lib/useDropdown";
import {
  BellIcon,
  ChevronRightIcon,
  GearIcon,
  MoreIcon,
  ProfileIcon,
  SearchIcon,
} from "./icons";
import styles from "./TopNav.module.css";

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
  const [darkTheme, setDarkTheme] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

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
          HabeshaLive
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
              <span className={styles.rowItem} title="Coming soon">
                <span className={styles.rowLabel}>Language</span>
                <ChevronRightIcon />
              </span>
              <button
                type="button"
                className={styles.rowItem}
                onClick={() => setDarkTheme((d) => !d)}
              >
                <span className={styles.rowLabel}>Dark theme</span>
                <span className={`${styles.toggle} ${darkTheme ? styles.toggleOn : ""}`}>
                  <span className={`${styles.toggleKnob} ${darkTheme ? styles.toggleKnobOn : ""}`} />
                </span>
              </button>
              <span className={styles.menuItem} title="Coming soon">
                Cookies &amp; Ads Choices
              </span>
              <span className={styles.rowItem} title="Coming soon">
                <span className={styles.rowLabel}>Labeled Content</span>
                <ChevronRightIcon />
              </span>
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
