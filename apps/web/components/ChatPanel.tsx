"use client";

import type { ChatMessage, GiftType, StreamActivity } from "@habeshalive/shared";
import { Centrifuge } from "centrifuge";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { API_BASE_URL, CENTRIFUGO_WS_URL } from "@/lib/config";
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

const WELCOME_MESSAGE: ChatEntry = {
  id: "sys-welcome",
  kind: "system",
  text: "Welcome to the chat! Please be respectful.",
};

async function fetchChatToken(): Promise<string> {
  // Deliberately hits the API directly (not the /api/backend proxy) — this
  // route is public on purpose, so anonymous viewers get real-time updates
  // too. Going through the proxy would 401 anyone without a session, since
  // the proxy itself requires one regardless of what the target route
  // needs. See apps/api/src/chat/token.ts.
  const res = await fetch(`${API_BASE_URL}/chat/token`, { method: "POST" });
  const data = await res.json();
  return data.token as string;
}

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
  const [messages, setMessages] = useState<ChatEntry[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const centrifuge = new Centrifuge(CENTRIFUGO_WS_URL, {
      getToken: fetchChatToken,
    });

    // Dedup-merge rather than blind-append: this runs on the initial mount
    // AND again every time the subscription resubscribes after a dropped
    // connection (mobile network blip, tab backgrounded and resumed) — see
    // the "subscribed" handler below. Anything published while the socket
    // was down never arrives as a "publication" event (that only fires for
    // messages published while actively connected), so without this
    // catch-up fetch on reconnect, a gap in the WS connection means a
    // permanent gap in that viewer's chat until they manually reload.
    function syncHistory() {
      fetch(`${API_BASE_URL}/chat/${streamId}/messages`)
        .then((res) => res.json())
        .then((history: ChatMessage[]) => {
          if (cancelled) return;
          setMessages((prev) => {
            const existingIds = new Set(prev.map((entry) => entry.id));
            const missing = history.filter((m) => !existingIds.has(m.id));
            if (missing.length === 0) return prev;
            return [
              ...prev,
              ...missing.map((m) => ({ id: m.id, kind: "message" as const, username: m.displayName, text: m.body })),
            ];
          });
        })
        .catch(() => {
          // A history load failure shouldn't block live updates from still
          // working — the WS subscription below is independent of this.
        });
    }

    syncHistory();

    const sub = centrifuge.newSubscription(`stream-chat:${streamId}`);
    sub.on("publication", (ctx) => {
      const m = ctx.data as ChatMessage;
      setMessages((prev) => {
        // Own messages are also appended in handleSend once its POST
        // resolves, and the two can arrive in either order (the server
        // publishes to Centrifugo before responding to the POST, so this
        // WS echo often wins the race) — dedup by id regardless of which
        // side runs first.
        if (prev.some((entry) => entry.id === m.id)) return prev;
        return [...prev, { id: m.id, kind: "message", username: m.displayName, text: m.body }];
      });
    });
    // Fires on the first successful subscribe AND again on every
    // resubscribe after a reconnect — re-syncing here (not just on mount)
    // is what actually closes the "missed messages during a drop" gap.
    sub.on("subscribed", syncHistory);
    sub.subscribe();
    centrifuge.connect();

    return () => {
      cancelled = true;
      sub.unsubscribe();
      centrifuge.disconnect();
    };
  }, [streamId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function dismissSystemMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/backend/chat/${streamId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to send");
      // Append immediately from the POST response rather than waiting on
      // the Centrifugo round-trip: a viewer who sends right after the page
      // loads can easily do so before the WS subscription (an async
      // getToken fetch, then connect+subscribe) finishes establishing,
      // which silently drops the echo for that message — the sender would
      // never see their own message without a manual reload. Dedup by id
      // here too, not just in the subscription handler below: the server
      // publishes to Centrifugo before responding to this POST, so the WS
      // echo can (and often does) reach the client before this fetch's
      // response does — without this check, both paths append the same
      // message and it shows up twice.
      const sent: ChatMessage = await res.json();
      setMessages((prev) => {
        if (prev.some((entry) => entry.id === sent.id)) return prev;
        return [...prev, { id: sent.id, kind: "message", username: sent.displayName, text: sent.body }];
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, kind: "system", text: "Message failed to send — try again." },
      ]);
    } finally {
      setSending(false);
    }
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
        <div ref={messagesEndRef} />
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
            disabled={sending}
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
          <button type="submit" className={`${styles.iconButton} ${styles.sendButton}`} aria-label="Send" disabled={sending}>
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
