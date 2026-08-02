"use client";

import type { PinnedMessage } from "@habeshalive/shared";
import { useState } from "react";
import { ChevronRightIcon, CloseIcon, PinIcon } from "./icons";
import styles from "./PinnedMessageBar.module.css";

export function PinnedMessageBar({
  pinned,
  canUnpin,
  onUnpin,
}: {
  pinned: PinnedMessage;
  canUnpin: boolean;
  onUnpin: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={styles.bar}>
      <button type="button" className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <PinIcon />
        <span className={styles.headerText}>Pinned by {pinned.pinnedByUsername}</span>
        <ChevronRightIcon className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ""}`} />
      </button>
      {!collapsed && (
        <div className={styles.bodyRow}>
          <p className={styles.body}>
            <span className={styles.bodyAuthor}>{pinned.message.displayName}:</span> {pinned.message.body}
          </p>
          {canUnpin && (
            <button type="button" className={styles.unpinButton} onClick={onUnpin} aria-label="Unpin message">
              <CloseIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
