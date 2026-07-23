"use client";

import { useState } from "react";
import { ChevronRightIcon, PinIcon } from "./icons";
import styles from "./PinnedMessageBar.module.css";

export function PinnedMessageBar({ moderator, text }: { moderator: string; text: string }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={styles.bar}>
      <button type="button" className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <PinIcon />
        <span className={styles.headerText}>Pinned by {moderator}</span>
        <ChevronRightIcon className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ""}`} />
      </button>
      {!collapsed && <p className={styles.body}>{text}</p>}
    </div>
  );
}
