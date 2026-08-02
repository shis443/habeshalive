"use client";

import { useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import styles from "./ShareSheet.module.css";
import { ShareIcon } from "./icons";

// D.3: NOT Twitch's target list — VK and Reddit are near-irrelevant in
// Ethiopia. Telegram is dominant locally, so it leads.
const TARGETS = [
  {
    label: "Telegram",
    href: (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    label: "WhatsApp",
    href: (url: string, text: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    label: "Facebook",
    href: (url: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    label: "X",
    href: (url: string, text: string) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
];

export function ShareSheet({ embedPath }: { embedPath?: string }) {
  const dropdown = useDropdown<HTMLDivElement>();
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  const url = typeof window !== "undefined" ? window.location.href : "";
  const text = typeof document !== "undefined" ? document.title : "Live on Birq";
  const embedUrl =
    typeof window !== "undefined" && embedPath ? `${window.location.origin}${embedPath}` : "";
  const embedSnippet = embedUrl
    ? `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`
    : "";

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyEmbed() {
    await navigator.clipboard.writeText(embedSnippet);
    setEmbedCopied(true);
    setTimeout(() => setEmbedCopied(false), 2000);
  }

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Share"
        onClick={() => {
          setShowEmbed(false);
          dropdown.setOpen((o) => !o);
        }}
      >
        <ShareIcon />
      </button>
      {dropdown.open && (
        <div className={styles.menu}>
          {!showEmbed ? (
            <>
              {TARGETS.map((target) => (
                <a
                  key={target.label}
                  href={target.href(url, text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.menuItem}
                >
                  {target.label}
                </a>
              ))}
              <button type="button" className={styles.menuItem} onClick={handleCopyUrl}>
                {copied ? "Copied!" : "Copy URL"}
              </button>
              {embedPath && (
                <button type="button" className={styles.menuItem} onClick={() => setShowEmbed(true)}>
                  Embed
                </button>
              )}
            </>
          ) : (
            <div className={styles.embedPanel}>
              <textarea className={styles.embedCode} readOnly value={embedSnippet} rows={3} />
              <button type="button" className={styles.menuItem} onClick={handleCopyEmbed}>
                {embedCopied ? "Copied!" : "Copy embed code"}
              </button>
              <button type="button" className={styles.menuItem} onClick={() => setShowEmbed(false)}>
                ← Back
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
