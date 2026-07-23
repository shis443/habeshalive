"use client";

import type { GiftType, StreamActivity } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatViewerCount } from "@/lib/format";
import { usernameColor } from "@/lib/userColor";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GiftModal } from "./GiftModal";
import { CloseIcon, GiftIcon, GroupIcon, MoreIcon, SendIcon } from "./icons";
import styles from "./ChatPanel.module.css";
import { PinnedMessageBar } from "./PinnedMessageBar";
import { StreamActivityStrip } from "./StreamActivityStrip";

type ChatEntry =
  | { id: string; kind: "system"; text: string }
  | { id: string; kind: "message"; username: string; text: string };

const INITIAL_MESSAGES: ChatEntry[] = [
  { id: "sys-1", kind: "system", text: "Welcome to the chat! Please be respectful." },
  { id: "m-1", kind: "message", username: "Abebe12", text: "This mix is fire! 🔥" },
  { id: "m-2", kind: "message", username: "Selamawit", text: "አሪፍ ነው!" },
];

export function ChatPanel({
  streamId,
  viewerCount,
  giftTypes,
  isAuthed,
  currentUsername,
  activity,
}: {
  streamId: string;
  viewerCount: number;
  giftTypes: GiftType[];
  isAuthed: boolean;
  currentUsername: string | null;
  activity: StreamActivity;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatEntry[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [giftModalOpen, setGiftModalOpen] = useState(false);

  function dismissSystemMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, kind: "message", username: currentUsername ?? "You", text: input.trim() },
    ]);
    setInput("");
  }

  function handleGiftClick() {
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setGiftModalOpen(true);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Stream Chat</span>
        <div className={styles.headerIcons}>
          <span className={styles.counter}>
            <GroupIcon />
            {formatViewerCount(viewerCount)}
          </span>
          <MoreIcon />
        </div>
      </div>

      <PinnedMessageBar moderator="cm_moderator" text="M3 LINKS → check the description for the Discord invite" />

      <StreamActivityStrip events={activity.recentEvents} />

      <div className={styles.messages}>
        {messages.map((entry) =>
          entry.kind === "system" ? (
            <div key={entry.id} className={styles.systemMessage}>
              <p className={styles.systemText}>{entry.text}</p>
              <button
                type="button"
                className={styles.dismissButton}
                onClick={() => dismissSystemMessage(entry.id)}
                aria-label="Dismiss"
              >
                <CloseIcon />
              </button>
            </div>
          ) : (
            <p key={entry.id} className={styles.message}>
              <span className={styles.username} style={{ color: usernameColor(entry.username) }}>
                {entry.username}
              </span>{" "}
              {entry.text}
            </p>
          )
        )}
      </div>

      <div className={styles.counters}>
        <span className={styles.counter}>🎁 {activity.giftsCount} gifts this stream</span>
        <span className={styles.counter}>⭐ {activity.activeSubscribers} subscribers</span>
      </div>

      <div className={styles.inputArea}>
        <form className={styles.inputRow} onSubmit={handleSend}>
          <input
            type="text"
            placeholder="Send a message..."
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <EmojiPickerButton onSelect={(emoji) => setInput((prev) => prev + emoji)} />
          <button
            type="button"
            className={`${styles.iconButton} ${styles.giftButton}`}
            aria-label="Send a gift"
            onClick={handleGiftClick}
          >
            <GiftIcon />
          </button>
          <button type="submit" className={`${styles.iconButton} ${styles.sendButton}`} aria-label="Send">
            <SendIcon />
          </button>
        </form>
        {!isAuthed && <p className={styles.loginHint}>Log in to chat and send gifts.</p>}
      </div>

      {giftModalOpen && (
        <GiftModal
          streamId={streamId}
          giftTypes={giftTypes}
          isAuthed={isAuthed}
          onClose={() => setGiftModalOpen(false)}
        />
      )}
    </div>
  );
}
