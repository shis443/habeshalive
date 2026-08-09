"use client";

import type { RecentGifter } from "@birq/shared";
import { useEffect, useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import { API_BASE_URL } from "@/lib/config";
import styles from "./RecentGiftersStrip.module.css";

// D.2 recent-gifter strip. Re-fetches on an interval rather than over the
// chat WebSocket — gifting is comparatively rare (unlike messages), so a
// third Centrifugo event type here isn't worth it next to a 20s poll.
//
// Hits the API directly, not the /api/backend proxy — this route is
// public (no auth needed to see who's gifted), but the proxy 401s
// everything without a session regardless of what the target route
// actually requires. Same reasoning as ChatPanel's fetchChatToken.
export function RecentGiftersStrip({ streamId }: { streamId: string }) {
  const [gifters, setGifters] = useState<RecentGifter[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch(`${API_BASE_URL}/chat/${streamId}/recent-gifters`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: RecentGifter[]) => {
          if (!cancelled) setGifters(data);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [streamId]);

  if (gifters.length === 0) return null;

  return (
    <div className={styles.strip}>
      {gifters.map((gifter, i) => {
        const avatarUrl = resolveAvatarUrl(gifter.avatarUrl);
        const key = gifter.userId ?? `anon-${i}`;
        return (
          <div key={key} className={styles.chip} title={`${(gifter.totalSantim / 100).toFixed(0)} birr`}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className={styles.avatar} />
            ) : (
              <span className={styles.avatarPlaceholder} />
            )}
            <span className={styles.name}>{gifter.isAnonymous ? "Anonymous" : gifter.username}</span>
          </div>
        );
      })}
    </div>
  );
}
