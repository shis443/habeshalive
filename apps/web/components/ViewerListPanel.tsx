"use client";

import type { ViewerList } from "@habeshalive/shared";
import { useEffect, useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { resolveAvatarUrl } from "@/lib/avatar";
import { API_BASE_URL } from "@/lib/config";
import styles from "./ShareSheet.module.css";
import panelStyles from "./ViewerListPanel.module.css";
import { GroupIcon } from "./icons";

const ROLE_BADGE: Record<string, string> = { moderator: "🛡️", admin: "👑" };
const GIFTER_BADGE: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇", platinum: "💎" };

// D.1: the people icon in the chat header opens this. Backed by
// Centrifugo's presence API (see streams/service.ts's getViewerList) —
// real connected viewers, not a client-side guess from who's spoken.
// Hits the API directly, not the /api/backend proxy — public route, same
// reasoning as RecentGiftersStrip/AnnouncementBanner.
export function ViewerListPanel({ streamId }: { streamId: string }) {
  const dropdown = useDropdown<HTMLDivElement>();
  const [list, setList] = useState<ViewerList | null>(null);

  useEffect(() => {
    if (!dropdown.open) return;
    fetch(`${API_BASE_URL}/streams/${streamId}/viewers`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setList)
      .catch(() => {});
  }, [dropdown.open, streamId]);

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={panelStyles.trigger}
        aria-label="Viewers in chat"
        onClick={() => dropdown.setOpen((o) => !o)}
      >
        <GroupIcon />
      </button>
      {dropdown.open && (
        <div className={`${styles.menu} ${panelStyles.panel}`}>
          {!list ? (
            <p className={panelStyles.empty}>Loading…</p>
          ) : list.viewers.length === 0 && list.anonymousCount === 0 ? (
            <p className={panelStyles.empty}>No one connected right now.</p>
          ) : (
            <>
              {list.viewers.map((viewer) => {
                const avatarUrl = resolveAvatarUrl(viewer.avatarUrl);
                return (
                  <div key={viewer.userId} className={panelStyles.row}>
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className={panelStyles.avatar} />
                    ) : (
                      <span className={panelStyles.avatarPlaceholder} />
                    )}
                    <span className={panelStyles.name}>{viewer.displayName}</span>
                    {ROLE_BADGE[viewer.role] && <span title={viewer.role}>{ROLE_BADGE[viewer.role]}</span>}
                    {GIFTER_BADGE[viewer.gifterBadgeTier] && (
                      <span title={`${viewer.gifterBadgeTier} gifter`}>{GIFTER_BADGE[viewer.gifterBadgeTier]}</span>
                    )}
                  </div>
                );
              })}
              {list.anonymousCount > 0 && (
                <p className={panelStyles.anonymous}>+{list.anonymousCount} anonymous</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
