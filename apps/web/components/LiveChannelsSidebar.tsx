"use client";

import type { LiveStream } from "@birq/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import { formatViewerCount } from "@/lib/format";
import styles from "./LiveChannelsSidebar.module.css";
import { ChevronRightIcon } from "./icons";

const STORAGE_KEY = "birq:sidebar-collapsed";

export function LiveChannelsSidebar({
  streams,
  defaultCollapsed = false,
}: {
  streams: LiveStream[];
  defaultCollapsed?: boolean;
}) {
  // Starts at defaultCollapsed (matching what the server rendered) to avoid
  // a hydration mismatch, then reconciles with whatever the visitor last
  // chose once mounted — a one-frame flash beats React complaining that
  // client/server markup diverged.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const sorted = [...streams].sort((a, b) => b.viewerCount - a.viewerCount);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.header}>
        {!collapsed && <span className={styles.headerLabel}>Live Channels</span>}
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          <ChevronRightIcon className={collapsed ? undefined : styles.chevronExpanded} />
        </button>
      </div>

      {sorted.length === 0 ? (
        !collapsed && <p className={styles.empty}>No one is live right now.</p>
      ) : (
        <div className={styles.list}>
          {sorted.map((stream) => {
            const avatarUrl = resolveAvatarUrl(stream.creator.avatarUrl);
            return (
            <Link key={stream.id} href={`/watch/${stream.creator.username}`} className={styles.row}>
              <span className={styles.avatarWrap}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className={styles.avatar} />
                ) : (
                  <span className={styles.avatarPlaceholder} />
                )}
              </span>
              {!collapsed && (
                <>
                  <span className={styles.info}>
                    <span className={styles.name}>{stream.creator.displayName}</span>
                    <span className={styles.category}>{stream.category ?? "—"}</span>
                  </span>
                  <span className={styles.viewerCount}>
                    <span className={styles.viewerDot} />
                    {formatViewerCount(stream.viewerCount)}
                  </span>
                </>
              )}
            </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
