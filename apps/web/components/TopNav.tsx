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

const MORE_GENERAL = ["About", "Advertisers", "Blog", "Careers", "Anchor Creator Program", "Gift Card"];
const MORE_LEGAL = ["Community Guidelines", "Privacy Notice", "Terms", "Safety Center"];

// No notifications backend exists yet — 0 is the honest count, not a fake
// placeholder number. The dropdown below always shows an empty state.
const UNREAD_COUNT = 0;

export function TopNav({ isAuthed }: { isAuthed: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const more = useDropdown<HTMLDivElement>();
  const notifications = useDropdown<HTMLDivElement>();
  const settings = useDropdown<HTMLDivElement>();
  const [darkTheme, setDarkTheme] = useState(true);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
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
            <div className={`${styles.dropdown} ${styles.dropdownWide}`}>
              <span className={styles.groupLabel}>General</span>
              {MORE_GENERAL.map((item) => (
                <span key={item} className={styles.menuItem} title="Coming soon">
                  {item}
                </span>
              ))}
              <div className={styles.divider} />
              <span className={styles.groupLabel}>Help &amp; Legal</span>
              {MORE_LEGAL.map((item) => (
                <span key={item} className={styles.menuItem} title="Coming soon">
                  {item}
                </span>
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
          <Link href="/dashboard" className={styles.iconButton} aria-label="Your account">
            <ProfileIcon />
          </Link>
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
