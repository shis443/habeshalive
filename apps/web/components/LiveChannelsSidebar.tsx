"use client";

import type { LiveStream } from "@habeshalive/shared";
import Link from "next/link";
import { useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import { formatViewerCount } from "@/lib/format";
import styles from "./LiveChannelsSidebar.module.css";
import { ChevronRightIcon } from "./icons";

export function LiveChannelsSidebar({
  streams,
  defaultCollapsed = false,
}: {
  streams: LiveStream[];
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const sorted = [...streams].sort((a, b) => b.viewerCount - a.viewerCount);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.header}>
        {!collapsed && <span className={styles.headerLabel}>Live Channels</span>}
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
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
                <span className={styles.liveDot} />
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
