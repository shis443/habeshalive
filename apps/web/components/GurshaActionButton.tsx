"use client";

import styles from "./TierActionDropdown.module.css";
import { GiftIcon } from "./icons";

// D.1: puts Gursha in the main action row alongside Follow/Subscribe,
// consistently styled (reuses TierActionDropdown's trigger classes rather
// than a one-off). Doesn't open a second GurshaModal instance — scrolls to
// and clicks chat's existing gift button, the same cross-navigation
// pattern TierActionDropdown's "Send Gursha instead" link already uses, so
// there's still exactly one GurshaModal in the tree regardless of which
// entry point opened it.
export function GurshaActionButton() {
  function handleClick() {
    const target = document.querySelector<HTMLButtonElement>('[aria-label="Send Gursha"]');
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.click();
  }

  return (
    <button type="button" className={styles.trigger} onClick={handleClick}>
      <GiftIcon />
      Gursha
    </button>
  );
}
