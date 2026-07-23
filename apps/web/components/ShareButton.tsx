"use client";

import { useState } from "react";
import { ShareIcon } from "./icons";
import styles from "./ShareButton.module.css";

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} onClick={handleClick} aria-label="Share">
        <ShareIcon />
      </button>
      {copied && <span className={styles.toast}>Copied!</span>}
    </div>
  );
}
