"use client";

import { followNotifyModeSchema, followStatusSchema, type FollowNotifyMode } from "@birq/shared";
import { useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import { useDropdown } from "@/lib/useDropdown";
import { BellIcon } from "./icons";
import styles from "./FollowButton.module.css";

// Real user feedback: "Personalized" read as if it meant something more
// than it does, and the only thing it actually changes (skipping
// scheduled-stream announcements while still alerting on go-live) is
// invisible unless you specifically test a scheduled stream rather than
// a live one. Relabeled to say exactly what each mode does — same
// distinction Twitch's own bell makes (All / Live only / Off), just
// worded plainly instead of a vague middle option. The underlying
// notify_mode values ('all'/'personalized'/'muted') are unchanged.
const NOTIFY_MODE_LABELS: Record<FollowNotifyMode, string> = {
  all: "All notifications",
  personalized: "Live only",
  muted: "Off",
};
const NOTIFY_MODE_DESCRIPTIONS: Record<FollowNotifyMode, string> = {
  all: "Alerts when they go live or schedule a stream",
  personalized: "Alerts only when they go live — no schedule announcements",
  muted: "No alerts, but you're still following",
};

export function FollowButton({
  creatorId,
  isAuthed,
  initialFollowing,
  initialNotifyMode = "all",
  // Only the channel header / watch page action row have room and reason
  // to show the per-creator notification bell — a compact grid card
  // (StreamCard.tsx) stays a plain Follow/Following toggle, matching how
  // Twitch itself only puts the bell on a channel page, not every card.
  showNotifyBell = false,
}: {
  creatorId: string;
  isAuthed: boolean;
  initialFollowing: boolean;
  initialNotifyMode?: FollowNotifyMode;
  showNotifyBell?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [notifyMode, setNotifyMode] = useState<FollowNotifyMode>(initialNotifyMode);
  const [loading, setLoading] = useState(false);
  // One-shot: true for the brief moment right after a follow lands, so the
  // button can flash a full fill before settling into the quieter
  // outline/tint look, instead of snapping straight there.
  const [justFollowed, setJustFollowed] = useState(false);
  const bellMenu = useDropdown<HTMLDivElement>();

  async function handleClick() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/follows/${creatorId}`, { method: "POST" });
      if (res.ok) {
        // The API wraps every response as { success, data, error } — see
        // apps/api/src/app.ts's preSerialization hook. Parsing the raw
        // body against followStatusSchema (as this previously did) throws
        // on every call, since {success,data,error} never matches
        // {following,followerCount} — the follow itself still applies
        // server-side (the request already succeeded by this point), but
        // the button silently never re-renders to reflect it.
        const body = (await res.json()) as { data: unknown };
        const data = followStatusSchema.parse(body.data);
        setFollowing(data.following);
        setNotifyMode(data.notifyMode);
        if (data.following) {
          setJustFollowed(true);
          setTimeout(() => setJustFollowed(false), 380);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSetNotifyMode(mode: FollowNotifyMode) {
    bellMenu.setOpen(false);
    const previous = notifyMode;
    setNotifyMode(mode); // optimistic — a real toggle a viewer expects to feel instant
    try {
      const res = await fetch(`/api/backend/follows/${creatorId}/notify-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyMode: mode }),
      });
      if (!res.ok) throw new Error("Failed to update");
    } catch {
      setNotifyMode(previous);
    }
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.button} ${following ? styles.buttonFollowing : ""} ${justFollowed ? styles.buttonJustFollowed : ""}`}
        onClick={handleClick}
        disabled={loading}
      >
        {following ? "Following" : "Follow"}
      </button>
      {showNotifyBell && following && (
        <div className={styles.bellWrap} ref={bellMenu.ref}>
          <button
            type="button"
            className={styles.bellButton}
            aria-label="Notification settings"
            onClick={() => bellMenu.setOpen((o) => !o)}
          >
            <BellIcon />
          </button>
          {bellMenu.open && (
            <div className={styles.bellMenu}>
              {followNotifyModeSchema.options.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.bellMenuItem} ${mode === notifyMode ? styles.bellMenuItemActive : ""}`}
                  onClick={() => handleSetNotifyMode(mode)}
                  title={NOTIFY_MODE_DESCRIPTIONS[mode]}
                >
                  {NOTIFY_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
