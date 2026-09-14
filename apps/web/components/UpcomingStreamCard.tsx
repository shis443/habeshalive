"use client";

import type { FollowNotifyMode, ScheduledStream } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import { BellIcon } from "./icons";
import styles from "./UpcomingStreamCard.module.css";

// Once the scheduled time has actually arrived, poll the same endpoint
// getLiveStreamByUsername reads from and refresh the (server-component)
// page the moment ingest is confirmed — promoteStartingStreams
// (apps/api/src/streams/service.ts) is what actually flips the backend
// status to 'live' and converts this row, this just notices and swaps the
// card out for the real player without a manual reload. Not started
// before the scheduled time — there's nothing to detect yet, and this
// page already loads fresh on every real navigation regardless.
const LIVE_POLL_INTERVAL_MS = 15_000;

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Starting soon";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Public "Upcoming Stream" audience card — YouTube-style live countdown +
// a "Remind me" bell. "Reminding" is just this codebase's existing
// follow/notify-mode machinery (0065_follow_notify_mode.sql): following
// with notify_mode 'all' already gets both this stream_scheduled
// notification and the eventual creator_live one, so there's no separate
// "reminders" concept to build — this button follows (or un-mutes) with
// one click instead of requiring a separate follow first.
export function UpcomingStreamCard({
  scheduledStream,
  creatorUsername,
  creatorId,
  isAuthed,
  initialFollowing,
  initialNotifyMode,
}: {
  scheduledStream: ScheduledStream;
  creatorUsername: string;
  creatorId: string;
  isAuthed: boolean;
  initialFollowing: boolean;
  initialNotifyMode: FollowNotifyMode;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [notifyMode, setNotifyMode] = useState<FollowNotifyMode>(initialNotifyMode);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const scheduledAtMs = new Date(scheduledStream.scheduledAt).getTime();
  useEffect(() => {
    if (now < scheduledAtMs) return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/backend/streams/username/${encodeURIComponent(creatorUsername)}`);
        const body = (await res.json()) as { data: unknown };
        if (res.ok && body.data) router.refresh();
      } catch {
        // Transient network error — the next tick just tries again.
      }
    }, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [now, scheduledAtMs, creatorUsername, router]);

  const reminderSet = following && notifyMode !== "muted";

  async function handleRemindMe() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    if (reminderSet) return;
    setLoading(true);
    try {
      if (!following) {
        const res = await fetch(`/api/backend/follows/${creatorId}`, { method: "POST" });
        if (res.ok) setFollowing(true);
      }
      if (following && notifyMode === "muted") {
        await fetch(`/api/backend/follows/${creatorId}/notify-mode`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notifyMode: "all" }),
        });
      }
      setNotifyMode("all");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      {scheduledStream.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI or advertiser-hosted, not a local asset
        <img src={scheduledStream.thumbnailUrl} alt="" className={styles.thumbnail} />
      )}
      <div className={styles.body}>
        <span className={styles.label}>Upcoming stream</span>
        <h3 className={styles.title}>{scheduledStream.title}</h3>
        {scheduledStream.caption && <p className={styles.caption}>{scheduledStream.caption}</p>}
        <div className={styles.meta}>
          <span className={styles.countdown}>
            {new Date(scheduledStream.scheduledAt).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · in {formatCountdown(scheduledAtMs - now)}
          </span>
          <button
            type="button"
            className={`${styles.remindButton} ${reminderSet ? styles.remindButtonActive : ""}`}
            onClick={handleRemindMe}
            disabled={loading || reminderSet}
          >
            <BellIcon />
            {reminderSet ? "Reminder set" : "Remind me"}
          </button>
        </div>
      </div>
    </div>
  );
}
